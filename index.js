// dotenv configuration
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from "body-parser";
import pkg from 'pg';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

const { Pool } = pkg;

// express app setup
const app = express();
const port = process.env.PORT || 5000;

// Postgres pool setup: use DATABASE_URL if available (Render)
let pool;
if (process.env.DATABASE_URL) {
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
} else {
    // fallback to individual env vars (for local dev)
    pool = new Pool({
        host: process.env.DB_HOST || "127.0.0.1",
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        port: process.env.DB_PORT ? parseInt(process.env.DB_PORT) : 5432,
        max: 10
    });
}

// Test DB connection
pool.connect()
    .then(client => {
        client.release();
        console.log("✅ Connected to Postgres DB");
    })
    .catch(err => console.error("❌ DB Connection Error:", err));

// required middlewares
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(passport.initialize());

// jwt token verification (keeps same behavior)
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

/* ----------------- GOOGLE STRATEGY (Postgres) ----------------- */
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
        const userRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (userRes.rows.length > 0) {
            return done(null, userRes.rows[0]);
        }

        // create new user, return the new row
        const insertRes = await pool.query(
            'INSERT INTO users (first_name, last_name, email, password) VALUES ($1, $2, $3, $4) RETURNING *',
            [name, '', email, ''] // empty last_name and password for OAuth users
        );


        return done(null, insertRes.rows[0]);
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
        const result = await pool.query('SELECT * FROM products');
        res.render('index', { products: result.rows, isLoggedIn: false });
    } catch (err) {
        console.error("DB Error:", err);
        return res.status(500).send("Server error");
    }
});

// login page get route
app.get('/login', (req, res) => res.render("login.ejs"));

// user signup page route
app.get('/signup', (req, res) => res.render("signup.ejs"));

// forgot password route
app.get('/forgotPassword', (req, res) => res.render("forgot-password.ejs"));

// dashboard page route
app.get('/dashboard', verifyToken, async (req, res) => {
    try {
        const userId = req.user.id;
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) return res.send("no user found");
        const user = userRes.rows[0];

        const productsRes = await pool.query('SELECT * FROM products');
        if (productsRes.rows.length === 0) return res.send("No Products");

        res.render("dashboard.ejs", { user, products: productsRes.rows });
    } catch (err) {
        console.error(err);
        res.status(500).send("Database error");
    }
});

// user signup post route
app.post('/signup', async (req, res) => {
    try {
        const { first_name, last_name, email, password } = req.body;

        const checkRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (checkRes.rows.length > 0) {
            return res.status(400).send('User already exists');
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        await pool.query(
            'INSERT INTO users(first_name, last_name, email, password) VALUES ($1, $2, $3, $4)',
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
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (result.rows.length === 0) {
            return res.send("no user found with this email!");
        }

        const user = result.rows[0];
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
        const usersRes = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

        if (usersRes.rows.length === 0) return res.send("No such user");
        const storedPassword = usersRes.rows[0].password;

        const match = await bcrypt.compare(currentPassword, storedPassword);
        if (!match) return res.send("your current password does not match!");

        if (newPassword !== confirmPassword) return res.send("new password does not match");

        const updatedPassword = await bcrypt.hash(newPassword, 10);
        await pool.query('UPDATE users SET password = $1 WHERE email = $2', [updatedPassword, email]);

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

        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) return res.send("database error");
        const user = userRes.rows[0];

        const productRes = await pool.query('SELECT * FROM products WHERE product_id = $1', [productID]);
        if (productRes.rows.length === 0) return res.send("No such product in the database");
        const product = productRes.rows[0];

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

        // check if exists
        const selectRes = await pool.query('SELECT * FROM cart WHERE user_id = $1 AND product_id = $2', [userId, productId]);

        if (selectRes.rows.length > 0) {
            await pool.query('UPDATE cart SET quantity = quantity + $1 WHERE user_id = $2 AND product_id = $3', [productQuantity, userId, productId]);
        } else {
            await pool.query('INSERT INTO cart(user_id, product_id, quantity) VALUES ($1, $2, $3)', [userId, productId, productQuantity]);
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
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userId]);
        if (userRes.rows.length === 0) return res.send("No such user in the database");
        const user = userRes.rows[0];

        const cartRes = await pool.query(
            `SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
       FROM cart c
       JOIN products p ON c.product_id = p.product_id
       WHERE c.user_id = $1`,
            [userId]
        );

        res.render('cart.ejs', { user, cartItems: cartRes.rows });
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

        await pool.query('DELETE FROM cart WHERE user_id = $1 AND cart_id = $2', [userID, cartID]);
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
        const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [userID]);
        if (userRes.rows.length === 0) return res.send("No such user in the database");
        const user = userRes.rows[0];

        const cartRes = await pool.query(
            `SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
       FROM cart c
       JOIN products p ON c.product_id = p.product_id
       WHERE c.user_id = $1`,
            [userID]
        );

        let total = 0;
        cartRes.rows.forEach(item => { total += parseFloat(item.total); });

        res.render('checkout.ejs', { user, cartItems: cartRes.rows, total });
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

        const cartRes = await pool.query(
            `SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total
       FROM cart c
       JOIN products p ON c.product_id = p.product_id
       WHERE c.user_id = $1`,
            [userID]
        );

        if (cartRes.rows.length === 0) return res.send("Your cart is empty");

        let total = 0;
        cartRes.rows.forEach(item => { total += parseFloat(item.total); });

        await pool.query(
            `INSERT INTO orders(user_id, full_name, phone_number, address, city, province, total_amount, payment_method)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [userID, full_name, phone_number, address, city, province, total, payment_method]
        );

        await pool.query('DELETE FROM cart WHERE user_id = $1', [userID]);

        res.send("your order has been placed successfully!");
    } catch (err) {
        console.error(err);
        res.send("error while placing the order");
    }
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});
