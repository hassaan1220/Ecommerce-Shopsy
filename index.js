// dotenv configuration
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from "body-parser";
import mysql from 'mysql2/promise';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

// express app setup
const app = express();
const port = process.env.PORT || 5000;

// MySQL pool setup
let pool;
try {
    pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    // Test DB connection
    const testConn = await pool.getConnection();
    console.log("✅ Connected to MySQL DB");
    testConn.release();
} catch (err) {
    console.error("❌ DB Connection Error:", err);
}

// required middlewares
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(passport.initialize());

// jwt token verification
function verifyToken(req, res, next) {
    const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.redirect('/login');
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error("JWT Error:", err);
            return res.redirect('/login');
        }
        req.user = decoded;
        next();
    });
}

/* ----------------- GOOGLE STRATEGY (MySQL) ----------------- */
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName || profile.name?.givenName || '';

        if (!email) return done(new Error("No email returned from Google"));

        // check if user exists
        const [userRes] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (userRes.length > 0) {
            return done(null, userRes[0]);
        }

        // create new user
        const [insertRes] = await pool.query(
            'INSERT INTO users (first_name, last_name, email, password) VALUES (?, ?, ?, ?)',
            [name, '', email, '']
        );

        const newUser = { id: insertRes.insertId, first_name: name, email };
        return done(null, newUser);
    } catch (err) {
        console.error("Google OAuth error:", err);
        return done(err);
    }
}));

// Google Auth Routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login', session: false }),
    (req, res) => {
        const user = req.user;
        const token = jwt.sign(
            { id: user.id, first_name: user.first_name || user.name, email: user.email, role: user.role || 'user' },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        res.redirect("/dashboard");
    }
);

// Home route → show products
app.get('/', async (req, res) => {
    const token = req.cookies?.token;
    if (token) {
        try {
            jwt.verify(token, process.env.JWT_SECRET);
            return res.redirect('/dashboard');
        } catch (err) {
            console.log("Invalid/Expired Token:", err.message);
        }
    }

    try {
        const [result] = await pool.query('SELECT * FROM products');
        res.render('index', { products: result, isLoggedIn: false });
    } catch (err) {
        console.error("DB Error:", err);
        return res.status(500).send("Server error");
    }
});

// login page get route
app.get('/login', (req, res) => res.render("login.ejs"));
app.get('/signup', (req, res) => res.render("signup.ejs"));
app.get('/forgotPassword', (req, res) => res.render("forgot-password.ejs"));

// dashboard page route
app.get('/dashboard', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [userRes] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (userRes.length === 0) return res.send("no user found");
        const user = userRes[0];

        const [productsRes] = await pool.query('SELECT * FROM products');
        if (productsRes.length === 0) return res.send("No Products");

        res.render("dashboard.ejs", { user, products: productsRes });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// user signup post route
app.post('/signup', async (req, res) => {
    try {
        const { first_name, last_name, email, password } = req.body;

        const [checkRes] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (checkRes.length > 0) {
            return res.status(400).send('User already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            'INSERT INTO users(first_name, last_name, email, password) VALUES (?, ?, ?, ?)',
            [first_name, last_name, email, hashedPassword]
        );

        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// user login post route
app.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;
        const [result] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

        if (result.length === 0) {
            return res.send("no user found with this email!");
        }

        const user = result[0];
        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.send("invalid credentials");

        const token = jwt.sign(
            { id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        res.redirect("/dashboard");
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// new password update route
app.post('/forgot-password', async (req, res) => {
    try {
        const { email, currentPassword, newPassword, confirmPassword } = req.body;
        const [usersRes] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

        if (usersRes.length === 0) return res.send("No such user");
        const storedPassword = usersRes[0].password;

        const match = await bcrypt.compare(currentPassword, storedPassword);
        if (!match) return res.send("your current password does not match!");

        if (newPassword !== confirmPassword) return res.send("new password does not match");

        const updatedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = ? WHERE email = ?', [updatedPassword, email]);

        res.redirect('/login');
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// logout route
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    res.redirect('/login');
});

// view products route
app.get('/view-product/:id', verifyToken, async (req, res) => {
    try {
        const productID = req.params.id;
        const userId = req.user.id;

        const [userRes] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (userRes.length === 0) return res.send("database error");
        const user = userRes[0];

        const [productRes] = await pool.query('SELECT * FROM products WHERE product_id = ?', [productID]);
        if (productRes.length === 0) return res.send("No such product in the database");
        const product = productRes[0];

        res.render('view-product.ejs', { user, product });
    } catch (err) {
        console.error(err);
        res.send("Error while fetching the products");
    }
});

// add-to-cart route
app.post('/add-to-cart/:id', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const productId = req.params.id;
        const productQuantity = parseInt(req.body.quantity) || 1;

        const [selectRes] = await pool.query('SELECT * FROM cart WHERE user_id = ? AND product_id = ?', [userId, productId]);

        if (selectRes.length > 0) {
            await pool.query('UPDATE cart SET quantity = quantity + ? WHERE user_id = ? AND product_id = ?', [productQuantity, userId, productId]);
        } else {
            await pool.query('INSERT INTO cart(user_id, product_id, quantity) VALUES (?, ?, ?)', [userId, productId, productQuantity]);
        }

        res.redirect('/cart');
    } catch (err) {
        console.error(err);
        res.send("Database Error");
    }
});

// user cart route
app.get('/cart', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const [userRes] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (userRes.length === 0) return res.send("No such user in the database");
        const user = userRes[0];

        const [cartRes] = await pool.query(
            `SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
             FROM cart c
             JOIN products p ON c.product_id = p.product_id
             WHERE c.user_id = ?`,
            [userId]
        );

        res.render('cart.ejs', { user, cartItems: cartRes });
    } catch (err) {
        console.error(err);
        res.send("Error while fetching the cart items");
    }
});

// remove product route
app.get('/removeItem/:id', verifyToken, async (req, res) => {
    try {
        const userID = req.user.id;
        const cartID = req.params.id;

        await pool.query('DELETE FROM cart WHERE user_id = ? AND cart_id = ?', [userID, cartID]);
        res.redirect("/cart");
    } catch (err) {
        console.error(err);
        res.status(500).send("Error while deleting the product.");
    }
});

// check out page route
app.get('/checkout', verifyToken, async (req, res) => {
    try {
        const userID = req.user.id;
        const [userRes] = await pool.query('SELECT * FROM users WHERE id = ?', [userID]);
        if (userRes.length === 0) return res.send("No such user in the database");
        const user = userRes[0];

        const [cartRes] = await pool.query(
            `SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
             FROM cart c
             JOIN products p ON c.product_id = p.product_id
             WHERE c.user_id = ?`,
            [userID]
        );

        let total = 0;
        cartRes.forEach(item => { total += parseFloat(item.total); });

        res.render('checkout.ejs', { user, cartItems: cartRes, total });
    } catch (err) {
        console.error(err);
        res.send("Error while fetching the cart items");
    }
});

// place order route
app.post('/place-order', verifyToken, async (req, res) => {
    try {
        const userID = req.user.id;
        const { full_name, phone_number, address, city, province, payment_method } = req.body;

        const [cartRes] = await pool.query(
            `SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
             FROM cart c
             JOIN products p ON c.product_id = p.product_id
             WHERE c.user_id = ?`,
            [userID]
        );

        if (cartRes.length === 0) return res.send("Your cart is empty");

        let total = 0;
        cartRes.forEach(item => { total += parseFloat(item.total); });

        await pool.query(
            `INSERT INTO orders(user_id, full_name, phone_number, address, city, province, total_amount, payment_method)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userID, full_name, phone_number, address, city, province, total, payment_method]
        );

        await pool.query('DELETE FROM cart WHERE user_id = ?', [userID]);

        res.send("your order has been placed successfully!");
    } catch (err) {
        console.error(err);
        res.send("error while placing the order");
    }
});

// orders page route 
app.get('/orders', verifyToken, (req, res) => {
    res.render("orders.ejs");
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
