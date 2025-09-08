// dotenv configuration
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import bodyParser from "body-parser";
import mysql from 'mysql';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';

// express app setup
const app = express();
const port = process.env.PORT;

// MySQL pool setup
const db = mysql.createPool({
    connectionLimit: 10, // max connections in pool
    host: process.env.DB_HOST || "127.0.0.1", // safer than localhost
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

// required middlewares
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(passport.initialize());

// jwt token verification
function verifyToken(req, res, next) {
    // Get token from cookies or Authorization header
    const token = req.cookies?.token || req.headers['authorization']?.split(' ')[1];
    if (!token) {
        return res.redirect('/login'); // no token found
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
            console.error("JWT Error:", err);
            return res.redirect('/login'); // invalid token
        }
        req.user = decoded; // { id, username }
        next();
    });
}

/* ----------------- GOOGLE STRATEGY ----------------- */
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, (accessToken, refreshToken, profile, done) => {
    const email = profile.emails[0].value;
    const name = profile.displayName;

    const sql = 'SELECT * FROM users WHERE email = ?';
    db.query(sql, [email], (err, results) => {
        if (err) return done(err);

        if (results.length > 0) {
            // User exists
            return done(null, results[0]);
        } else {
            // Create new user
            const insertSql = 'INSERT INTO users (first_name, email) VALUES (?, ?)';
            db.query(insertSql, [name, email], (err, result) => {
                if (err) return done(err);
                const newUser = { id: result.insertId, first_name: name, email };
                return done(null, newUser);
            });
        }
    });
}));

// Google Auth Routes
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

app.get(
    '/auth/google/callback',
    passport.authenticate('google', { failureRedirect: '/login', session: false }),
    (req, res) => {
        // req.user is returned from GoogleStrategy
        const user = req.user;

        // Sign JWT
        const token = jwt.sign(
            { id: user.id, first_name: user.first_name || user.name, email: user.email, role: user.role || 'user' },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        // Set cookie (httpOnly for security)
        res.cookie("token", token, { httpOnly: true, secure: false });

        // Redirect to dashboard
        res.redirect("/dashboard");
    }
);

app.get('/', (req, res) => {
    const token = req.cookies?.token;

    if (token) {
        try {
            // Verify JWT token
            jwt.verify(token, process.env.JWT_SECRET);

            // Token sahi aur expire nahi hua → dashboard par bhej do
            return res.redirect('/dashboard');
        } catch (err) {
            // Token galat ya expire → ignore, normal page dikhao
            console.log("Invalid/Expired Token:", err.message);
        }
    }

    // Yahan tab ayega jab token hi na ho ya invalid ho
    db.query('SELECT * FROM products', (err, products) => {
        if (err) {
            console.error("DB Error:", err);
            return res.status(500).send("Server error");
        }

        res.render('index', { products, isLoggedIn: false });
    });
});


// login page get route
app.get('/login', (req, res) => {
    res.render("login.ejs");
});

// user signup page route
app.get('/signup', (req, res) => {
    res.render("signup.ejs");
});

// forgot password route
app.get('/forgotPassword', (req, res) => {
    res.render("forgot-password.ejs");
});

// dashboard page route
app.get('/dashboard', verifyToken, (req, res) => {
    const userId = req.user.id;

    // Fetch user info
    db.query('SELECT * FROM users WHERE id = ?', [userId], (err, users) => {
        if (err) {
            return res.status(500).send("Database error");
        }
        if (users.length === 0) {
            return res.send("no user found");
        }
        // fetch the results
        const user = users[0];

        // Fetch Products on dashboard
        const productsQuery = 'SELECT * FROM products';
        db.query(productsQuery, (err, products) => {
            if (err) {
                return res.status(500).send("Database error");
            }
            if (products.length === 0) {
                return res.send("No Products");
            }
            if (products.length > 0) {
                res.render("dashboard.ejs", { user, products });
            }
        });
    });
});

// user signup post route
app.post('/signup', (req, res) => {
    // Extracting user details from the request body through body-parser
    const { first_name, last_name, email, password } = req.body;
    // check if user already exists
    const userCheckQuery = 'SELECT * FROM users WHERE email	= ?';
    db.query(userCheckQuery, [email], async (err, results) => {
        if (err) {
            return res.status(500).send("Database error");
        }
        if (results.length > 0) {
            return res.status(400).send('User already exists');
        }
        // Hash the password using bcrypt
        const hashedPassword = await bcrypt.hash(password, 10);
        // insert user into the database
        const insertQuery = 'INSERT INTO users(first_name, last_name, email, password) VALUES (?, ?, ?, ?)';
        db.query(insertQuery, [first_name, last_name, email, hashedPassword], (err) => {
            if (err) {
                return res.status(500).send("Database error");
            }
            // Redirect to login page after successful signup
            res.redirect('/login');
        });
    });
});

// user login post route
app.post("/login", (req, res) => {
    const { email, password } = req.body;

    // fetching the user according to the provided email
    const query = 'SELECT * FROM users WHERE email = ?';

    // query execution for checking whether the user with provided email is present or not
    db.query(query, [email], async (err, users) => {
        // database error handling
        if (err) {
            return res.status(500).send("Database error");
        }
        // in case any user is not present
        if (users.length === 0) {
            return res.send("no user found with this email!");
        }

        // and if it is so fetch it and save it in the variable
        const user = users[0];

        // comparing the user credentials(password) for authorization
        const match = await bcrypt.compare(password, user.password);
        if (!match) {
            return res.send("invalid credentials");
        }

        // jwt token
        const token = jwt.sign(
            { id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1h" }
        );

        // Set token in HTTP-Only cookie
        res.cookie("token", token, { httpOnly: true, secure: false });

        // rendering the dashboard page after successfull login
        res.redirect("/dashboard");
    });
});

// new password update route
app.post('/forgot-password', (req, res) => {
    // fetching the form data through bodyparser middleware
    const { email, currentPassword, newPassword, confirmPassword } = req.body;
    // checking user email whether it is registered or not
    const query = 'SELECT * FROM users WHERE email = ?';
    db.query(query, [email], async (err, users) => {
        // error handling
        if (err) {
            return res.status(500).send("Database error");
        }
        const storedPassword = users[0].password;

        // comparing the password
        const match = await bcrypt.compare(currentPassword, storedPassword);
        if (!match) {
            return res.send("your current password does not match!");
        }

        // checking whether the new password is confirmed
        if (newPassword !== confirmPassword) {
            return res.send("new password does not match");
        }

        // hashing the new password
        const updatedPassword = await bcrypt.hash(newPassword, 10);

        const updateQuery = 'UPDATE users SET password = ? WHERE email = ?';
        db.query(updateQuery, [updatedPassword, email], (err) => {
            if (err) {
                return res.status(500).send("Database error");
            }
            res.redirect('/login');
        });
    });
});

// logout route
app.get('/logout', (req, res) => {
    // Clear the 'token' cookie
    res.clearCookie('token');
    // Redirect to login page
    res.redirect('/login');
});

// view products route
app.get('/view-product/:id', verifyToken, (req, res) => {
    // fetching the product id through params
    const productID = req.params.id;
    const userId = req.user.id;

    // fetching the user from the database
    const selectQuery = 'SELECT * FROM users WHERE id = ?';
    db.query(selectQuery, [userId], (err, users) => {
        if (err) {
            return res.send("database error");
        }
        // fetch the results
        const user = users[0];

        // now fetching the products from the database according to thier ids
        const SelectQuery = 'SELECT * FROM products WHERE product_id = ?'; // declaring the variable and using the parameterized query to ignore the sql injection
        db.query(SelectQuery, [productID], (err, products) => {
            // using conditional statements for error handling
            if (err) {
                return res.send("Error while fetching the products");
            } if (products.length === 0) {
                return res.send("No such product in the database");
            }
            const product = products[0];
            res.render('view-product.ejs', { user, product });
        });
    });
});

// user cart route
app.get('/cart', verifyToken, (req, res) => {
    // fetching the user id from the token
    const userId = req.user.id;

    // db query for fetching the user
    const SelectQuery = 'SELECT * FROM users WHERE id = ?';
    db.query(SelectQuery, [userId], (err, users) => {
        if (err) {
            return res.send("Database Error");
        } if (users.length === 0) {
            return res.send("No such user in the database");
        }
        const user = users[0];

        // Fetching the products in the cart of the respective user
        const SelectCartQuery = 'SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total FROM cart c JOIN products p ON c.product_id = p.product_id WHERE c.user_id = ?';
        db.query(SelectCartQuery, [userId], (err, result) => {
            if (err) {
                return res.send("Error while fetching the cart items");
            }
            res.render('cart.ejs', { user, cartItems: result });
        })
    })
});

// add-to-cart route
app.post('/add-to-cart/:id', verifyToken, (req, res) => {
    const userId = req.user.id;
    const productId = req.params.id;
    const productQuantity = req.body.quantity || 1;

    // checking whether this product is in the cart or not
    const SelectQuery = 'SELECT * FROM cart WHERE user_id = ? and product_id = ?';
    db.query(SelectQuery, [userId, productId], (err, result) => {
        // if there is an error while running the query it will return an error
        if (err) {
            return res.send("Database Error");
        }

        // if there is an already an same item in the cart it will update and add the quantity
        if (result.length > 0) {
            const updateQuery = 'UPDATE cart SET quantity = quantity + ? WHERE user_id = ? AND product_id = ?';
            db.query(updateQuery, [productQuantity, userId, productId], (err) => {
                if (err) {
                    return res.send("Error while updating the product");
                }
                res.redirect('/cart');
            });
        }

        // and if there is no item in the cart, so then it will add your item in the cart
        else {
            const insertQuery = 'INSERT INTO cart(user_id, product_id, quantity) VALUES (?,?,?)';
            db.query(insertQuery, [userId, productId, productQuantity], (err) => {
                if (err) {
                    return res.send("Error while inserting the item in your cart");
                }
                res.redirect('/cart');
            });
        }
    })
});

// remove product route
app.get('/removeItem/:id', verifyToken, (req, res) => {
    const userID = req.user.id;
    const cartID = req.params.id;

    // sql query to remove item in the cart
    const DeleteQuery = 'DELETE FROM cart WHERE user_id = ? AND cart_id = ?';
    db.query(DeleteQuery, [userID, cartID], (err) => {
        if (err) {
            console.error(err);
            return res.status(500).send("Error while deleting the product.");
        }
        res.redirect("/cart");
    });
})

// check out page route
app.get('/checkout', verifyToken, (req, res) => {
    // fetching the user_id from the token
    const userID = req.user.id;

    // db query for fetching the user
    const SelectQuery = 'SELECT * FROM users WHERE id = ?';
    db.query(SelectQuery, [userID], (err, users) => {
        if (err) {
            return res.send("Database Error");
        } if (users.length === 0) {
            return res.send("No such user in the database");
        }
        const user = users[0];

        // sql query to fetch the item from the cart according to the user id
        const SelectQuery = 'SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total FROM cart c JOIN products p ON c.product_id = p.product_id WHERE c.user_id = ?';
        db.query(SelectQuery, [userID], (err, results) => {
            if (err) {
                return res.send("Error while fetching the cart items");
            }

            // calculating the total
            let total = 0;
            results.forEach(item => {
                total += item.total;
            });

            res.render('checkout.ejs', { user, cartItems: results, total });
        })
    })
});

// place order route
app.post('/place-order', verifyToken, (req, res) => {
    // fetching the user id from the token
    const userID = req.user.id;
    // fetching the form data from the ejs file through body parser
    const { full_name, phone_number, address, city, province, payment_method } = req.body;

    // select query for calculating the total of the cart
    const SelectQuery = 'SELECT c.cart_id, p.name, p.price, c.quantity, (p.price * c.quantity) AS total FROM cart c JOIN products p ON c.product_id = p.product_id WHERE c.user_id = ?';
    db.query(SelectQuery, [userID], (err, results) => {
        if (err) {
            return res.send("Error while fetching the cart items");
        }

        // calculating the total
        let total = 0;
        results.forEach(item => {
            total += item.total;
        });

        const InsertQuery = 'INSERT INTO orders(user_id, full_name, phone_number, address, city, province, total_amount, payment_method) VALUES (?, ?, ?, ?, ?, ?, ?, ?)';
        db.query(InsertQuery, [userID, full_name, phone_number, address, city, province, total, payment_method], (err) => {
            if (err) {
                return res.send("error while placing the order");
            }
            res.send("your order has been placed successfully!");
        });
    })
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});