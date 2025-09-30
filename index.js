// dotenv configuration
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from "body-parser";
import mysql from 'mysql2';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

const app = express();
const port = process.env.PORT || 10000;

// MySQL pool setup
const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// optional: quick test
pool.getConnection((err, connection) => {
    if (err) {
        console.error('❌ MySQL connection error:', err);
    } else {
        console.log('✅ Connected to MySQL (pool)');
        connection.release();
    }
});

// middlewares
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(passport.initialize());

// verifyToken middleware
function verifyToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = req.cookies?.token || (authHeader ? authHeader.split(' ')[1] : null);
    if (!token) return res.redirect('/login');

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.redirect('/login');
        req.user = decoded;
        return next();
    });
}

/* ---------------- GOOGLE STRATEGY ---------------- */
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails?.[0]?.value;
    const name = profile.displayName || profile.name?.givenName || '';

    if (!email) return done(new Error("No email returned from Google"));

    pool.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
        if (err) return done(err);
        if (result.length > 0) return done(null, result[0]);

        pool.query(
            'INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)',
            [name, '', email, ''],
            (err, insertRes) => {
                if (err) return done(err);
                return done(null, { id: insertRes.insertId, first_name: name, email });
            }
        );
    });
}));

// Google Auth
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get('/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login', session: false }),
    (req, res) => {
        const user = req.user;
        const token = jwt.sign(
            { id: user.id, first_name: user.first_name, email: user.email, role: user.role || 'user' },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );
        res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        return res.redirect("/dashboard");
    }
);

/* ---------------- ROUTES ---------------- */
// Home
app.get('/', (req, res) => {
    const token = req.cookies?.token;

    if (token) {
        jwt.verify(token, process.env.JWT_SECRET, (err) => {
            if (!err) {
                // agar token valid hai to dashboard bhej do aur neeche ka code na chale
                return res.redirect('/dashboard');
            } else {
                // agar token invalid hai to products render karo
                pool.query('SELECT * FROM products', (err, result) => {
                    if (err) return res.status(500).send("Server error");
                    return res.render('index', { products: result, isLoggedIn: false });
                });
            }
        });
    } else {
        // agar token hi nahi hai
        pool.query('SELECT * FROM products', (err, result) => {
            if (err) return res.status(500).send("Server error");
            return res.render('index', { products: result, isLoggedIn: false });
        });
    }
});


// login/signup/forgot
app.get('/login', (req, res) => res.render("login.ejs"));
app.get('/signup', (req, res) => res.render("signup.ejs"));
app.get('/forgotPassword', (req, res) => res.render("forgot-password.ejs"));

// dashboard
app.get('/dashboard', verifyToken, (req, res) => {
    const userId = req.user.id;
    pool.query('SELECT * FROM users WHERE id = ?', [userId], (err, userRes) => {
        if (err || userRes.length === 0) return res.send("no user found");
        const user = userRes[0];
        pool.query('SELECT * FROM products', (err, productsRes) => {
            if (err) return res.send("No Products");
            return res.render("dashboard.ejs", { user, products: productsRes });
        });
    });
});

// signup POST
app.post('/signup', (req, res) => {
    const { first_name, last_name, email, password } = req.body;
    pool.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
        if (err) return res.send("Error while fetching user!");
        if (result.length > 0) return res.status(400).send('User already exists');

        bcrypt.hash(password, 10, (err, hashedPassword) => {
            if (err) return res.send("Error while hashing password!");
            pool.query(
                'INSERT INTO users(first_name, last_name, email, password) VALUES (?, ?, ?, ?)',
                [first_name, last_name, email, hashedPassword],
                (err) => {
                    if (err) return res.send("Error while registering the user!");
                    return res.redirect('/login');
                }
            );
        });
    });
});

// login POST
app.post("/login", (req, res) => {
    const { email, password } = req.body;
    pool.query('SELECT * FROM users WHERE email = ?', [email], (err, result) => {
        if (err) return res.send("Error while fetching the user!");
        if (result.length === 0) return res.send("No user found with this email!");

        const user = result[0];
        bcrypt.compare(password, user.password, (err, isMatch) => {
            if (err) return res.send("Error while checking password!");
            if (!isMatch) return res.send("Invalid credentials");

            const token = jwt.sign(
                { id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: "1h" }
            );
            res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
            return res.redirect("/dashboard");
        });
    });
});

// logout
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    return res.redirect('/login');
});

// view product
app.get('/view-product/:id', verifyToken, (req, res) => {
    const productID = req.params.id;
    const userId = req.user.id;

    pool.query('SELECT * FROM users WHERE id = ?', [userId], (err, userRes) => {
        if (err || userRes.length === 0) return res.send("database error");
        const user = userRes[0];
        pool.query('SELECT * FROM products WHERE product_id = ?', [productID], (err, productRes) => {
            if (err || productRes.length === 0) return res.send("No such product in the database");
            return res.render('view-product.ejs', { user, product: productRes[0] });
        });
    });
});

// add to cart
app.post('/add-to-cart/:id', verifyToken, (req, res) => {
    const userId = req.user.id;
    const productId = req.params.id;
    const productQuantity = parseInt(req.body.quantity) || 1;

    pool.query('SELECT * FROM cart WHERE user_id = ? AND product_id = ?', [userId, productId], (err, selectRes) => {
        if (err) return res.send("Database Error");

        if (selectRes.length > 0) {
            pool.query(
                'UPDATE cart SET quantity = quantity + ? WHERE user_id = ? AND product_id = ?',
                [productQuantity, userId, productId],
                () => { return res.redirect('/cart'); }
            );
        } else {
            pool.query(
                'INSERT INTO cart(user_id, product_id, quantity) VALUES (?, ?, ?)',
                [userId, productId, productQuantity],
                () => { return res.redirect('/cart'); }
            );
        }
    });
});

// cart
app.get('/cart', verifyToken, (req, res) => {
    const userId = req.user.id;
    pool.query('SELECT * FROM users WHERE id = ?', [userId], (err, userRes) => {
        if (err || userRes.length === 0) return res.send("No such user in the database");
        const user = userRes[0];

        const cartQuery = `
            SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
            FROM cart c
            JOIN products p ON c.product_id = p.product_id
            WHERE c.user_id = ?
        `;
        pool.query(cartQuery, [userId], (err, cartRes) => {
            if (err) return res.send("Error while fetching the cart items");
            return res.render('cart.ejs', { user, cartItems: cartRes });
        });
    });
});

// remove item
app.get('/removeItem/:id', verifyToken, (req, res) => {
    const userID = req.user.id;
    const cartID = req.params.id;
    pool.query('DELETE FROM cart WHERE user_id = ? AND cart_id = ?', [userID, cartID], (err) => {
        if (err) return res.status(500).send("Error while deleting the product.");
        return res.redirect("/cart");
    });
});

// checkout
app.get('/checkout', verifyToken, (req, res) => {
    const userID = req.user.id;
    pool.query('SELECT * FROM users WHERE id = ?', [userID], (err, result) => {
        if (err || result.length === 0) return res.send("Error while fetching user");
        const user = result[0];

        const cartQuery = `
            SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
            FROM cart c
            JOIN products p ON c.product_id = p.product_id
            WHERE c.user_id = ?
        `;
        pool.query(cartQuery, [userID], (err, result) => {
            if (err) return res.send("Error while fetching the cart items");
            let total = 0;
            result.forEach(item => total += parseFloat(item.total));
            return res.render('checkout.ejs', { user, cartItems: result, total });
        });
    });
});

// place order
app.post('/place-order', verifyToken, (req, res) => {
    const userID = req.user.id;
    const { full_name, phone_number, address, city, province, payment_method } = req.body;

    const cartQuery = `
        SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
        FROM cart c
        JOIN products p ON c.product_id = p.product_id
        WHERE c.user_id = ?
    `;
    pool.query(cartQuery, [userID], (err, result) => {
        if (err) return res.send("Error while fetching cart items");
        if (result.length === 0) return res.send("Your cart is empty");

        let total = 0;
        result.forEach(item => total += parseFloat(item.total));

        pool.query(
            'INSERT INTO orders(user_id, full_name, phone_number, address, city, province, total_amount, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [userID, full_name, phone_number, address, city, province, total, payment_method],
            (err) => {
                if (err) return res.send("Error while placing the order");
                pool.query('DELETE FROM cart WHERE user_id = ?', [userID], (err) => {
                    if (err) return res.send("Error while clearing the cart");
                    return res.send("Your order has been placed successfully!");
                });
            }
        );
    });
});

// orders
app.get('/orders', verifyToken, (req, res) => {
    const user_id = req.user.id;
    pool.query('SELECT * FROM users WHERE id = ?', [user_id], (err, result) => {
        if (err || result.length === 0) return res.send("Error while fetching user");
        const user = result[0];
        return res.render('orders.ejs', { user });
    });
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
