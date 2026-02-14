require('dotenv').config({ path: '/var/www/env/rassapp.env' });
const express = require('express');
const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Logging Middleware
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_change_this';

// Nodemailer Transporter
// NOTE: Ensure these ENV variables are set for real email sending.
// If not set, the code will be logged to the console.
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
    },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
});

// Initialize Database Tables
const initDB = async () => {
  try {
    // Users Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'manager',
        manager_id TEXT,
        permissions JSONB,
        allowed_investor_ids JSONB,
        phone TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Data Items Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS data_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        data JSONB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Verification Codes Table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS verification_codes (
        email TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        expires_at TIMESTAMP NOT NULL,
        attempts INTEGER DEFAULT 0
      );
    `);

    // Indexes
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_users_manager_id ON users(manager_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_data_items_user_id ON data_items(user_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_data_items_type ON data_items(type);`);

    console.log('PostgreSQL Tables Initialized');
  } catch (err) {
    console.error('Error initializing database:', err);
  }
};

initDB();

// --- MIDDLEWARE ---

const auth = (req, res, next) => {
  const token = req.header('x-auth-token');
  if (!token) return res.status(401).json({ msg: 'No token, authorization denied' });

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (e) {
    res.status(400).json({ msg: 'Token is not valid' });
  }
};

// --- HELPER FUNCTIONS ---

const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendEmail = async (email, subject, text) => {
    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
            await transporter.sendMail({
                from: `"InstallMate" <${process.env.SMTP_USER}>`,
                to: email,
                subject,
                text,
            });
            console.log(`Email sent to ${email}`);
            return true;
        } catch (error) {
            console.error('Email send error:', error);
            return false;
        }
    } else {
        console.log('================================================');
        console.log(`[MOCK EMAIL] To: ${email}`);
        console.log(`[MOCK EMAIL] Subject: ${subject}`);
        console.log(`[MOCK EMAIL] Body: ${text}`);
        console.log('================================================');
        return true; // Simulate success
    }
};

// --- ROUTES ---

// Health Check
app.get('/', (req, res) => {
    res.send('InstallMate API is running');
});

// 1. Auth Routes

// Send Verification Code
app.post('/api/auth/send-code', async (req, res) => {
    const { email, type } = req.body; // type: 'REGISTER' or 'RESET'

    try {
        const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        const userExists = userCheck.rows.length > 0;

        if (type === 'REGISTER' && userExists) {
            return res.status(400).json({ msg: 'Пользователь с таким Email уже существует' });
        }
        if (type === 'RESET' && !userExists) {
            return res.status(400).json({ msg: 'Пользователь не найден' });
        }

        const code = generateCode();
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

        // Upsert code
        await pool.query(`
            INSERT INTO verification_codes (email, code, expires_at, attempts)
            VALUES ($1, $2, $3, 0)
            ON CONFLICT (email) 
            DO UPDATE SET code = $2, expires_at = $3, attempts = 0
        `, [email, code, expiresAt]);

        const subject = type === 'REGISTER' ? 'Код подтверждения регистрации' : 'Код восстановления пароля';
        const message = `Ваш код подтверждения для InstallMate: ${code}. Код действителен 10 минут.`;

        await sendEmail(email, subject, message);

        res.json({ msg: 'Код отправлен' });
    } catch (err) {
        console.error('Send Code Error:', err);
        res.status(500).send('Server error');
    }
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, code, role, managerId, permissions, allowedInvestorIds } = req.body;

  try {
    // 1. Verify Code
    const codeCheck = await pool.query('SELECT * FROM verification_codes WHERE email = $1', [email]);
    if (codeCheck.rows.length === 0) {
        return res.status(400).json({ msg: 'Сначала запросите код' });
    }

    const record = codeCheck.rows[0];
    if (new Date() > new Date(record.expires_at)) {
        return res.status(400).json({ msg: 'Код истек' });
    }
    if (record.code !== code) {
        return res.status(400).json({ msg: 'Неверный код' });
    }

    // 2. Check User Existence (Double check)
    const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ msg: 'Пользователь уже существует' });
    }

    const id = role === 'manager' ? `u_${Date.now()}` : (role === 'investor' ? `u_inv_${Date.now()}` : `u_emp_${Date.now()}`);

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert User
    await pool.query(
      `INSERT INTO users (id, name, email, password, role, manager_id, permissions, allowed_investor_ids) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        name,
        email,
        hashedPassword,
        role || 'manager',
        managerId || null,
        JSON.stringify(permissions || {}),
        JSON.stringify(allowedInvestorIds || [])
      ]
    );

    // Clean up code
    await pool.query('DELETE FROM verification_codes WHERE email = $1', [email]);

    // Create default account for managers
    if (!role || role === 'manager' || role === 'admin') {
        const accId = `acc_main_${id}`;
        const accData = { id: accId, userId: id, name: 'Основной счет', type: 'MAIN' };
        await pool.query(
            `INSERT INTO data_items (id, user_id, type, data) VALUES ($1, $2, $3, $4)`,
            [accId, id, 'accounts', JSON.stringify(accData)]
        );
    }

    const token = jwt.sign({ id, role: role || 'manager', managerId }, JWT_SECRET, { expiresIn: '30d' });

    res.json({ token, user: { id, name, email, role: role || 'manager', managerId, permissions, allowedInvestorIds } });
  } catch (err) {
    console.error('Register Error:', err);
    res.status(500).send('Server error');
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
    const { email, code, newPassword } = req.body;

    try {
        // 1. Verify Code
        const codeCheck = await pool.query('SELECT * FROM verification_codes WHERE email = $1', [email]);
        if (codeCheck.rows.length === 0) {
            return res.status(400).json({ msg: 'Сначала запросите код' });
        }

        const record = codeCheck.rows[0];
        if (new Date() > new Date(record.expires_at)) {
            return res.status(400).json({ msg: 'Код истек' });
        }
        if (record.code !== code) {
            return res.status(400).json({ msg: 'Неверный код' });
        }

        // 2. Update Password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        await pool.query('UPDATE users SET password = $1, updated_at = NOW() WHERE email = $2', [hashedPassword, email]);

        // Clean up code
        await pool.query('DELETE FROM verification_codes WHERE email = $1', [email]);

        res.json({ msg: 'Пароль успешно изменен' });
    } catch (err) {
        console.error('Reset Password Error:', err);
        res.status(500).send('Server error');
    }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) return res.status(400).json({ msg: 'Неверные учетные данные' });

    const user = result.rows[0];

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ msg: 'Неверные учетные данные' });

    const token = jwt.sign({ id: user.id, role: user.role, managerId: user.manager_id }, JWT_SECRET, { expiresIn: '30d' });

    res.json({
        token,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            managerId: user.manager_id,
            permissions: user.permissions,
            allowedInvestorIds: user.allowed_investor_ids
        }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).send('Server error');
  }
});

// 2. Data Routes (Sync/Load)
app.get('/api/data', auth, async (req, res) => {
    try {
        const targetUserId = (req.user.role === 'employee' || req.user.role === 'investor') ? req.user.managerId : req.user.id;

        // Fetch Data Items
        const itemsResult = await pool.query('SELECT * FROM data_items WHERE user_id = $1', [targetUserId]);

        const result = {
            customers: [], products: [], sales: [], expenses: [], accounts: [], investors: [], partnerships: []
        };

        itemsResult.rows.forEach(row => {
            if (result[row.type]) {
                result[row.type].push(row.data);
            }
        });

        // Fetch Employees
        const usersResult = await pool.query('SELECT * FROM users WHERE manager_id = $1 AND role = $2', [targetUserId, 'employee']);
        const employees = usersResult.rows.map(u => ({
            id: u.id,
            name: u.name,
            email: u.email,
            role: u.role,
            permissions: u.permissions,
            allowedInvestorIds: u.allowed_investor_ids
        }));

        res.json({ ...result, employees });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// 3. CRUD Routes for Entities
app.post('/api/data/:type', auth, async (req, res) => {
    try {
        const { type } = req.params;
        const itemData = req.body;
        const targetUserId = (req.user.role === 'employee' || req.user.role === 'investor') ? req.user.managerId : req.user.id;

        const id = itemData.id;

        // Upsert using ON CONFLICT (Postgres specific)
        await pool.query(`
            INSERT INTO data_items (id, user_id, type, data, updated_at)
            VALUES ($1, $2, $3, $4, NOW())
            ON CONFLICT (id) 
            DO UPDATE SET 
                data = EXCLUDED.data, 
                type = EXCLUDED.type,
                user_id = EXCLUDED.user_id,
                updated_at = NOW();
        `, [id, targetUserId, type, JSON.stringify(itemData)]);

        // Return the saved data
        res.json(itemData);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

app.delete('/api/data/:type/:id', auth, async (req, res) => {
    try {
        const { id } = req.params;
        const targetUserId = (req.user.role === 'employee' || req.user.role === 'investor') ? req.user.managerId : req.user.id;

        await pool.query('DELETE FROM data_items WHERE id = $1 AND user_id = $2', [id, targetUserId]);
        res.json({ success: true, id });
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error');
    }
});

// User Management (Create / Update / Delete for Sub-users)
app.post('/api/users/manage', auth, async (req, res) => {
    const { action, userData } = req.body;

    if (req.user.role !== 'manager' && req.user.role !== 'admin') {
        return res.status(403).json({ msg: 'Permission denied' });
    }

    try {
        if (action === 'create') {
            const { name, email, password, role, permissions, allowedInvestorIds, phone } = userData;

            // Check existence
            const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            if (userCheck.rows.length > 0) {
              return res.status(400).json({ msg: 'User already exists' });
            }

            // Create ID
            const id = role === 'investor' ? `u_inv_${Date.now()}` : `u_emp_${Date.now()}`;

            // Hash Password
            const salt = await bcrypt.genSalt(10);
            const hashedPassword = await bcrypt.hash(password, salt);

            // Insert linked to current manager (req.user.id)
            await pool.query(
              `INSERT INTO users (id, name, email, password, role, manager_id, permissions, allowed_investor_ids, phone) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [
                id,
                name,
                email,
                hashedPassword,
                role,
                req.user.id, // FORCE manager_id to be the current logged in user
                JSON.stringify(permissions || {}),
                JSON.stringify(allowedInvestorIds || []),
                phone || null
              ]
            );

            // Return the created user object (NO TOKEN, so manager stays logged in)
            return res.json({
                id, name, email, role, managerId: req.user.id, permissions, allowedInvestorIds, phone
            });
        }

        if (action === 'delete') {
            await pool.query('DELETE FROM users WHERE id = $1 AND manager_id = $2', [userData.id, req.user.id]);
            return res.json({ success: true, id: userData.id });
        }

        if (action === 'update') {
            const { id, name, email, permissions, allowedInvestorIds } = userData;
            // Simple update, usually password change is separate or handled specifically
            await pool.query(`
                UPDATE users 
                SET name = $1, email = $2, permissions = $3, allowed_investor_ids = $4, updated_at = NOW()
                WHERE id = $5 AND manager_id = $6
            `, [name, email, JSON.stringify(permissions), JSON.stringify(allowedInvestorIds), id, req.user.id]);

            return res.json({ success: true });
        }

        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).send('Server Error');
    }
});

app.listen(PORT, '0.0.0.0', () => console.log(`Server started on port ${PORT} (0.0.0.0)`));