// dotenv configuration
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from "body-parser";
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import pkg from 'pg';

const { Pool } = pkg;

const app = express();
const port = process.env.PORT || 10000;

// PostgreSQL pool setup
const pool = new Pool({
    host: process.env.PGHOST,
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    port: process.env.PGPORT,
    ssl: { rejectUnauthorized: false }
});

// optional: quick test
pool.connect()
    .then(() => console.log('✅ Connected to PostgreSQL'))
    .catch(err => console.error('❌ PostgreSQL connection error:', err));

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
}, async (accessToken, refreshToken, profile, done) => {
    try {
        const email = profile.emails?.[0]?.value;
        const name = profile.displayName || profile.name?.givenName || '';

        if (!email) return done(new Error("No email returned from Google"));

        const existing = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) return done(null, existing.rows[0]);

        const insertRes = await pool.query(
            'INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, '', email, '']
        );
        return done(null, insertRes.rows[0]);
    } catch (err) {
        return done(err);
    }
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
app.get('/', async (req, res) => {
    const token = req.cookies?.token;

    const fetchProducts = async (isLoggedIn) => {
        try {
            const result = await pool.query('SELECT * FROM products');
            return res.render('index', { products: result.rows, isLoggedIn });
        } catch {
            return res.status(500).send("Server error");
        }
    };

    if (token) {
        jwt.verify(token, process.env.JWT_SECRET, async (err) => {
            if (!err) return res.redirect('/dashboard');
            return fetchProducts(false);
        });
    } else {
        return fetchProducts(false);
    }
});

// login/signup/forgot
app.get('/login', (req, res) => res.render("login.ejs"));
app.get('/signup', (req, res) => res.render("signup.ejs"));
app.get('/forgotPassword', (req, res) => res.render("forgot-password.ejs"));

// dashboard
app.get('/dashboard', verifyToken, async (req, res) => {
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.send("no user found");

        const productsRes = await pool.query('SELECT * FROM products');
        return res.render("dashboard.ejs", { user: userRes.rows[0], products: productsRes.rows });
    } catch {
        return res.send("Error fetching data");
    }
});

// signup POST
app.post('/signup', async (req, res) => {
    const { first_name, last_name, email, password } = req.body;
    try {
        const checkUser = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (checkUser.rows.length > 0) return res.status(400).send('User already exists');

        const hashedPassword = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users(first_name, last_name, email, password) VALUES ($1, $2, $3, $4)',
            [first_name, last_name, email, hashedPassword]
        );
        return res.redirect('/login');
    } catch {
        return res.send("Error while registering the user!");
    }
});

// login POST
app.post("/login", async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.send("No user found with this email!");

        const user = result.rows[0];
        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.send("Invalid credentials");

        const token = jwt.sign(
            { id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );
        res.cookie("token", token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
        return res.redirect("/dashboard");
    } catch {
        return res.send("Login error");
    }
});

// logout
app.get('/logout', (req, res) => {
    res.clearCookie('token');
    return res.redirect('/login');
});

// view product
app.get('/view-product/:id', verifyToken, async (req, res) => {
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.send("database error");
        const user = userRes.rows[0];

        const productRes = await pool.query('SELECT * FROM products WHERE product_id = $1', [req.params.id]);
        if (productRes.rows.length === 0) return res.send("No such product in the database");

        return res.render('view-product.ejs', { user, product: productRes.rows[0] });
    } catch {
        return res.send("Error fetching product");
    }
});

// add to cart
app.post('/add-to-cart/:id', verifyToken, async (req, res) => {
    const userId = req.user.id;
    const productId = req.params.id;
    const productQuantity = parseInt(req.body.quantity) || 1;

    try {
        const selectRes = await pool.query('SELECT * FROM cart WHERE user_id = $1 AND product_id = $2', [userId, productId]);

        if (selectRes.rows.length > 0) {
            await pool.query(
                'UPDATE cart SET quantity = quantity + $1 WHERE user_id = $2 AND product_id = $3',
                [productQuantity, userId, productId]
            );
        } else {
            await pool.query(
                'INSERT INTO cart(user_id, product_id, quantity) VALUES ($1, $2, $3)',
                [userId, productId, productQuantity]
            );
        }
        return res.redirect('/cart');
    } catch {
        return res.send("Database Error");
    }
});

// cart
app.get('/cart', verifyToken, async (req, res) => {
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.send("No such user in the database");
        const user = userRes.rows[0];

        const cartQuery = `
            SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
            FROM cart c
            JOIN products p ON c.product_id = p.product_id
            WHERE c.user_id = $1
        `;
        const cartRes = await pool.query(cartQuery, [req.user.id]);
        return res.render('cart.ejs', { user, cartItems: cartRes.rows });
    } catch {
        return res.send("Error while fetching the cart items");
    }
});

// remove item
app.get('/removeItem/:id', verifyToken, async (req, res) => {
    try {
        await pool.query('DELETE FROM cart WHERE user_id = $1 AND cart_id = $2', [req.user.id, req.params.id]);
        return res.redirect("/cart");
    } catch {
        return res.status(500).send("Error while deleting the product.");
    }
});

// checkout
app.get('/checkout', verifyToken, async (req, res) => {
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.send("Error while fetching user");
        const user = userRes.rows[0];

        const cartQuery = `
            SELECT c.cart_id, p.product_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
            FROM cart c
            JOIN products p ON c.product_id = p.product_id
            WHERE c.user_id = $1
        `;
        const cartRes = await pool.query(cartQuery, [req.user.id]);

        let total = 0;
        cartRes.rows.forEach(item => total += parseFloat(item.total));

        return res.render('checkout.ejs', { user, cartItems: cartRes.rows, total });
    } catch {
        return res.send("Error while fetching the cart items");
    }
});

// place order POST request
app.post('/place-order', verifyToken, async (req, res) => {
    const userID = req.user.id;
    const { full_name, phone_number, address, city, province, payment_method } = req.body;

    try {
        const cartQuery = `
            SELECT c.cart_id, c.product_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
            FROM cart c
            JOIN products p ON c.product_id = p.product_id
            WHERE c.user_id = $1
        `;
        const cartItems = (await pool.query(cartQuery, [userID])).rows;
        if (cartItems.length === 0) return res.send("Your cart is empty");
        
        let total = 0;
        cartItems.forEach(item => total += parseFloat(item.total));

        const orderQuery = `INSERT INTO orders(user_id, full_name, phone_number, address, city, province, total_amount, payment_method)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING order_id`;
        const orderResult = await pool.query(orderQuery, [
            userID, full_name, phone_number, address, city, province, total, payment_method
        ]);
        const orderId = orderResult.rows[0].order_id;

        for (const item of cartItems) {
            await pool.query(
                'INSERT INTO order_items_details(order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
                [orderId, item.product_id, item.quantity, item.price]
            );
        }

        await pool.query('DELETE FROM cart WHERE user_id = $1', [userID]);
        return res.redirect('/');
    } catch (err) {
        console.error("Order Error:", err);
        return res.send("Error while placing the order");
    }
});

// orders
app.get('/orders', verifyToken, async (req, res) => {
    try {
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        if (userRes.rows.length === 0) return res.send("Error while fetching user");
        const user = userRes.rows[0];
        return res.render('orders.ejs', { user });
    } catch {
        return res.send("Error while fetching user orders");
    }
});

app.listen(port, () => {
    console.log(`🚀 Server is running on http://localhost:${port}`);
});
