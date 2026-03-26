require('dotenv').config({ path: '/var/www/env/rassapp.env' });
// FORCE TIMEZONE TO MOSCOW
process.env.TZ = 'Europe/Moscow';
console.log('YOOKASSA_SHOP_ID loaded:', process.env.YOOKASSA_SHOP_ID ? '✅ Yes' : '❌ No');
console.log('YOOKASSA_SECRET_KEY loaded:', process.env.YOOKASSA_SECRET_KEY ? '✅ Yes' : '❌ No');
console.log('GREEN_API_PARTNER_TOKEN loaded:', process.env.GREEN_API_PARTNER_TOKEN ? '✅ Yes' : '❌ No');
console.log('Server Timezone:', new Date().toString());

const express = require('express');

const { Pool } = require('pg');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');

const app = express();
app.set('trust proxy', 1);

// ✅ БЕЛЫЙ СПИСОК ТИПОВ ДАННЫХ (защита от инъекций)
const VALID_DATA_TYPES = ['customers', 'products', 'sales', 'expenses', 'accounts', 'investors', 'partnerships', 'settings'];

// ✅ ХЕЛПЕР: Определение целевого пользователя для загрузки данных
const getTargetUserId = (user) => {
  // Сотрудники видят данные своего менеджера
  if (user.role === 'employee') {
    return user.managerId;
  }
  // Инвесторы, менеджеры и админы видят СВОИ данные
  return user.id;
};

// ✅ ХЕЛПЕР: Проверка прав доступа
const canAccessUserData = (currentUser, targetUserId) => {
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'manager' && targetUserId === currentUser.id) return true;
  if (currentUser.role === 'employee' && targetUserId === currentUser.managerId) return true;
  if (currentUser.role === 'investor' && targetUserId === currentUser.id) return true;
  return false;
};

// Middleware
app.use(cors());
app.use(express.json({
  limit: '15mb',
  type: (req) => {
    if (req.url.startsWith('/api/payments/webhook')) return false;
    if (req.url.startsWith('/api/upload-image')) return false;
    if (req.url.startsWith('/api/integrations/whatsapp/webhook')) return false;
    return true;
  }
}));

// Logging Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ✅ RATE LIMITING для защиты от подбора пароля
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 5, // 5 попыток
  message: { error: 'Слишком много попыток входа, попробуйте позже' },
  standardHeaders: true,
  legacyHeaders: false,
});

const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret_key_change_this';

// Nodemailer Transporter
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: process.env.SMTP_PORT || 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || undefined,
});

// Force Postgres Session Timezone
pool.on('connect', (client) => {
  client.query("SET TIME ZONE 'Europe/Moscow'", (err) => {
    if(err) console.error("Error setting DB timezone", err);
  });
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
        subscription JSONB,
        whatsapp_settings JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Ensure subscription column exists (Migration for existing DBs)
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='subscription') THEN
          ALTER TABLE users ADD COLUMN subscription JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='whatsapp_settings') THEN
          ALTER TABLE users ADD COLUMN whatsapp_settings JSONB;
        END IF;
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='api_key') THEN
          ALTER TABLE users ADD COLUMN api_key TEXT UNIQUE;
        END IF;
      END $$;
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
    initSuperAdmin();
  } catch (err) {
    console.error('Error initializing database:', err);
  }
};

const initSuperAdmin = async () => {
  const adminEmail = process.env.SUPER_ADMIN_EMAIL || 'borz017795@gmail.com';
  const adminPass = process.env.SUPER_ADMIN_PASSWORD || 'admin123';
  try {
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(adminPass, salt);
    // Upsert Admin User
    await pool.query(`
      INSERT INTO users (id, name, email, password, role, subscription)
      VALUES ('super_admin', 'Super Admin', $1, $2, 'admin', '{"plan":"BUSINESS","expiresAt":"2099-12-31T23:59:59.999Z"}')
      ON CONFLICT (email) DO UPDATE SET
        role = 'admin',
        password = $2
    `, [adminEmail, hashedPassword]);
    console.log(`Super Admin initialized: ${adminEmail}`);
  } catch (e) {
    console.error('Failed to init super admin', e);
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
    console.error("Auth Token Error:", e.message);
    res.status(400).json({ msg: 'Token is not valid' });
  }
};

const adminAuth = (req, res, next) => {
  auth(req, res, () => {
    if (req.user.role === 'admin') {
      next();
    } else {
      res.status(403).json({ msg: 'Access denied: Admins only' });
    }
  });
};

// --- HELPER FUNCTIONS ---
const generateCode = () => Math.floor(100000 + Math.random() * 900000).toString();

const sendEmail = async (email, subject, text) => {
  if (process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      await transporter.sendMail({
        from: `"FinUchet" <${process.env.SMTP_USER}>`,
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

// --- INTEGRATIONS ---
app.post('/api/integrations/whatsapp/create', auth, async (req, res) => {
  console.log("Entering WhatsApp Create Route");
  const { phoneNumber } = req.body;
  const partnerToken = process.env.GREEN_API_PARTNER_TOKEN ? process.env.GREEN_API_PARTNER_TOKEN.trim() : null;
  
  if (!partnerToken) {
    console.error("Partner Token Missing on Server");
    return res.status(500).json({ msg: 'Partner Token not configured on server' });
  }
  
  try {
    console.log(`Requesting Green API with token: ${partnerToken.substring(0, 5)}... Phone: ${phoneNumber}`);
    const cleanPhone = phoneNumber ? phoneNumber.replace(/\D/g, '') : '';
    
    const response = await axios.post('https://api.green-api.com/partner/createInstance', {
      type: "whatsapp",
      mark: `User ${req.user.email} (ID: ${req.user.id}) ${cleanPhone ? `[Phone: ${cleanPhone}]` : ''}`
    }, {
      headers: {
        'Authorization': `Bearer ${partnerToken}`,
        'Content-Type': 'application/json',
        'User-Agent': 'InstallMate/1.0 (NodeJS)'
      }
    });
    
    console.log("Green API Success:", response.data);
    res.json(response.data);
  } catch (error) {
    let errorDetails = error.message;
    if (error.response) {
      console.error('Green API Response Status:', error.response.status);
      console.error('Green API Response Headers:', JSON.stringify(error.response.headers));
      errorDetails = error.response.data;
      if (typeof errorDetails === 'string' && errorDetails.trim().startsWith('<html')) {
        console.error('Green API returned HTML error (likely WAF or 403 Forbidden):', errorDetails.substring(0, 200));
        errorDetails = `Green API returned HTML error (${error.response.status}). Check Partner Token and permissions.`;
      }
    } else {
      console.error('Green API Network Error:', error.message);
    }
    res.status(500).json({
      msg: 'Failed to create WhatsApp instance',
      details: typeof errorDetails === 'object' ? JSON.stringify(errorDetails) : errorDetails
    });
  }
});

// --- WHATSAPP WEBHOOK ---
const normalizePhone = (phone) => {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 10) {
    if (cleaned.startsWith('9')) return '7' + cleaned;
  }
  if (cleaned.length === 11) {
    if (cleaned.startsWith('8')) return '7' + cleaned.slice(1);
    if (cleaned.startsWith('7')) return cleaned;
  }
  return cleaned;
};

async function sendMessage(idInstance, apiTokenInstance, chatId, message) {
  try {
    const response = await axios.post(
      `https://api.green-api.com/waInstance${idInstance}/sendMessage/${apiTokenInstance}`,
      { chatId, message },
      { timeout: 10000 }
    );
    return !!response.data?.idMessage;
  } catch (e) {
    console.error("WHATSAPP SEND ERROR:", e.message);
    return false;
  }
}

app.post(
  '/api/integrations/whatsapp/webhook',
  express.json({ limit: '15mb' }),
  async (req, res) => {
    try {
      console.log("==== WHATSAPP WEBHOOK START ====");
      const body = req.body;
      const { typeWebhook, senderData, messageData, instanceData } = body;
      
      res.status(200).send('OK');
      
      if (!senderData?.chatId || typeWebhook !== 'incomingMessageReceived') return;
      if (messageData?.typeMessage !== 'textMessage') return;
      
      const chatId = senderData.chatId;
      if (chatId.includes('@g.us')) return;
      
      const rawPhone = chatId.replace('@c.us', '');
      const senderPhone = normalizePhone(rawPhone);
      const text = (messageData.textMessageData.textMessage || '').trim().toLowerCase();
      
      const instanceId = instanceData?.idInstance;
      const managerResult = await pool.query(`
        SELECT id, name, whatsapp_settings
        FROM users
        WHERE whatsapp_settings->>'idInstance' = $1
        LIMIT 1
      `, [String(instanceId)]);
      
      if (managerResult.rows.length === 0) return;
      
      const manager = managerResult.rows[0];
      const { id: managerId, name: managerName, whatsapp_settings: settings } = manager;
      
      if (!settings?.botEnabled) return;
      
      const customersResult = await pool.query(`
        SELECT id, data
        FROM data_items
        WHERE type = 'customers'
        AND user_id = $1
      `, [managerId]);
      
      const customerRow = customersResult.rows.find(row =>
        normalizePhone(row.data.phone || '') === senderPhone
      );
      
      if (!customerRow) {
        await sendMessage(settings.idInstance, settings.apiTokenInstance, chatId,
          `Здравствуйте 👋 Я ассистент ${managerName}. У вас нет активных договоров.`
        );
        return;
      }
      
      const customerId = customerRow.id;
      let customerData = customerRow.data;
      
      if (customerData.lastBotResponse === undefined) {
        const updatedCustomer = { ...customerData, lastBotResponse: null };
        await pool.query(
          `UPDATE data_items SET data = $1 WHERE id = $2`,
          [JSON.stringify(updatedCustomer), customerId]
        );
        customerData = updatedCustomer;
      }
      
      const lastResponse = customerData.lastBotResponse;
      
      const salesResult = await pool.query(`
        SELECT data FROM data_items
        WHERE user_id = $1
        AND type = 'sales'
        AND data->>'customerId' = $2
        AND data->>'status' = '"ACTIVE"'
      `, [managerId, customerId]);
      
      const activeSales = salesResult.rows.map(r => r.data);
      
      if (activeSales.length === 0) {
        await sendMessage(settings.idInstance, settings.apiTokenInstance, chatId, "У вас нет активных договоров.");
        return;
      }
      
      let command = null;
      if (text === '1' || text.includes('долг') || text.includes('задолженность')) {
        command = 'debt';
      } else if (text === '2' || text.includes('дата') || text.includes('платеж')) {
        command = 'payment';
      } else if (text === '3' || text.includes('условия') || text.includes('рассрочка')) {
        command = 'conditions';
      }
      
      const sendMsg = async (msg) => {
        await sendMessage(settings.idInstance, settings.apiTokenInstance, chatId, msg);
      };
      
      if (command) {
        if (lastResponse === command) return;
        
        let responseText = '';
        if (command === 'debt') {
          const totalDebt = activeSales.reduce((sum, sale) =>
            sum + sale.paymentPlan.filter(p => !p.isPaid).reduce((s, p) => s + p.amount, 0), 0);
          responseText = `📊 Ваш текущий долг: *${totalDebt.toLocaleString()} ₽*`;
        }
        else if (command === 'payment') {
          const allUnpaid = activeSales.flatMap(sale =>
            sale.paymentPlan.filter(p => !p.isPaid).map(p => ({ ...p, productName: sale.productName }))
          ).sort((a, b) => new Date(a.date) - new Date(b.date));
          
          if (allUnpaid.length === 0) {
            responseText = "Все платежи оплачены!";
          } else {
            const next = allUnpaid[0];
            const dateStr = new Date(next.date).toLocaleDateString('ru-RU', {
              day: 'numeric', month: 'long', year: 'numeric'
            });
            responseText = `📅 Ближайший платёж:
• Товар: *${next.productName}*
• Дата: *${dateStr}*
• Сумма: *${next.amount.toLocaleString()} ₽*`;
          }
        }
        else if (command === 'conditions') {
          const maxTerm = Math.max(...activeSales.map(s => s.installments || 0));
          const minRate = Math.min(...activeSales.map(s => s.interestRate || 0));
          const firstPayment = activeSales[0].downPayment > 0 ? activeSales[0].downPayment.toLocaleString() : 'не требуется';
          responseText = `📝 Условия рассрочки:
• Срок: до *${maxTerm} мес.*
• Процентная ставка: от *${minRate}%*
• Первый взнос: *${firstPayment} ₽*`;
        }
        
        await sendMsg(responseText);
        const updatedCustomer = { ...customerData, lastBotResponse: command };
        await pool.query(
          `UPDATE data_items SET data = $1 WHERE id = $2`,
          [JSON.stringify(updatedCustomer), customerId]
        );
        return;
      }
      
      const greeting = `Здравствуйте 👋 Я ассистент ${managerName}. Чем могу помочь?
1. 📊 Мой долг
2. 📅 Дата платежа
3. Условия рассрочки
(Ответьте цифрой или текстом)`;
      await sendMsg(greeting);
      
      if (lastResponse !== null) {
        const resetCustomer = { ...customerData, lastBotResponse: null };
        await pool.query(
          `UPDATE data_items SET data = $1 WHERE id = $2`,
          [JSON.stringify(resetCustomer), customerId]
        );
      }
    } catch (error) {
      console.error("WEBHOOK CRASH:", error);
    }
  }
);

// Send Verification Code
app.post('/api/auth/send-code', async (req, res) => {
  const { email, type } = req.body;
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
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    
    await pool.query(`
      INSERT INTO verification_codes (email, code, expires_at, attempts)
      VALUES ($1, $2, $3, 0)
      ON CONFLICT (email)
      DO UPDATE SET code = $2, expires_at = $3, attempts = 0
    `, [email, code, expiresAt]);
    
    const subject = type === 'REGISTER' ? 'Код подтверждения регистрации' : 'Код восстановления пароля';
    const message = `Ваш код подтверждения для FinUchet: ${code}. Код действителен 10 минут.`;
    
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
    
    // 2. Check User Existence
    const userCheck = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userCheck.rows.length > 0) {
      return res.status(400).json({ msg: 'Пользователь уже существует' });
    }
    
    const id = role === 'manager' ? `u_${Date.now()}` : (role === 'investor' ? `u_inv_${Date.now()}` : `u_emp_${Date.now()}`);
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    
    // Initial Subscription (3 Days Trial) for Managers
    let subscription = null;
    if (!role || role === 'manager' || role === 'admin') {
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + 3);
      subscription = {
        plan: 'TRIAL',
        expiresAt: expiresAt.toISOString()
      };
    }
    
    // Insert User
    await pool.query(
      `INSERT INTO users (id, name, email, password, role, manager_id, permissions, allowed_investor_ids, subscription)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        id,
        name,
        email,
        hashedPassword,
        role || 'manager',
        managerId || null,
        JSON.stringify(permissions || {}),
        JSON.stringify(allowedInvestorIds || []),
        subscription ? JSON.stringify(subscription) : null
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
    res.json({ token, user: { id, name, email, role: role || 'manager', managerId, permissions, allowedInvestorIds, subscription } });
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

// ✅ ИСПРАВЛЕННЫЙ ЛОГИН С RATE LIMITING
app.post('/api/auth/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body;
  
  // ✅ Простая валидация входных данных
  if (!email || !password || typeof email !== 'string' || typeof password !== 'string') {
    return res.status(400).json({ msg: 'Email и пароль обязательны' });
  }
  
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
        allowedInvestorIds: user.allowed_investor_ids,
        subscription: user.subscription,
        whatsapp_settings: user.whatsapp_settings
      }
    });
  } catch (err) {
    console.error('Login Error:', err);
    res.status(500).send('Server error');
  }
});

// Get current user
app.get('/api/auth/me', auth, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, email, role, manager_id, subscription, whatsapp_settings FROM users WHERE id = $1',
      [req.user.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ msg: 'User not found' });
    }
    
    const user = result.rows[0];
    res.json({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      managerId: user.manager_id,
      subscription: user.subscription,
      whatsapp_settings: user.whatsapp_settings,
      apiKey: user.role === 'admin' ? user.api_key : undefined
    });
  } catch (err) {
    console.error('Me Error:', err);
    res.status(500).send('Server error');
  }
});

// Update WhatsApp Settings
app.post('/api/user/whatsapp', auth, async (req, res) => {
  const settings = req.body;
  try {
    await pool.query('UPDATE users SET whatsapp_settings = $1, updated_at = NOW() WHERE id = $2',
      [JSON.stringify(settings), req.user.id]
    );
    res.json({ success: true });
  } catch (e) {
    console.error("WhatsApp settings update error:", e);
    res.status(500).send('Server Error');
  }
});

// Subscription Management
app.post('/api/user/subscription', auth, async (req, res) => {
  const { plan, months } = req.body;
  
  if (req.user.role !== 'manager' && req.user.role !== 'admin') {
    return res.status(403).json({ msg: 'Only managers can subscribe' });
  }
  
  try {
    const userResult = await pool.query('SELECT subscription FROM users WHERE id = $1', [req.user.id]);
    let currentSub = userResult.rows[0]?.subscription || { plan: 'TRIAL', expiresAt: new Date().toISOString() };
    
    let newExpiresAt = new Date(currentSub.expiresAt);
    if (newExpiresAt < new Date()) {
      newExpiresAt = new Date();
    }
    newExpiresAt.setMonth(newExpiresAt.getMonth() + Number(months));
    
    const updatedSub = {
      plan: plan,
      expiresAt: newExpiresAt.toISOString()
    };
    
    await pool.query('UPDATE users SET subscription = $1 WHERE id = $2', [JSON.stringify(updatedSub), req.user.id]);
    res.json({ subscription: updatedSub });
  } catch (e) {
    console.error("Subscription update error:", e);
    res.status(500).send('Server Error');
  }
});

// ✅ ИСПРАВЛЕННЫЙ GET /api/data - ИНВЕСТОРЫ ВИДЯТ ТОЛЬКО СВОИ ДАННЫЕ
app.get('/api/data', auth, async (req, res) => {
  try {
    // ✅ Правильная логика: инвесторы → свой id, сотрудники → managerId
    const targetUserId = getTargetUserId(req.user);
    
    // 🔐 Проверка прав доступа
    if (!canAccessUserData(req.user, targetUserId)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    const itemsResult = await pool.query('SELECT * FROM data_items WHERE user_id = $1', [targetUserId]);
    
    const result = {
      customers: [], products: [], sales: [], expenses: [], accounts: [], investors: [], partnerships: [], settings: null
    };
    
    itemsResult.rows.forEach(row => {
      if (row.type === 'settings') {
        result.settings = row.data;
      } else if (result[row.type]) {
        result[row.type].push(row.data);
      }
    });
    
    // Fetch Employees (только менеджеры/админы видят сотрудников)
    let employees = [];
    if (req.user.role === 'manager' || req.user.role === 'admin') {
      const usersResult = await pool.query('SELECT * FROM users WHERE manager_id = $1 AND role = $2', [req.user.id, 'employee']);
      employees = usersResult.rows.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        permissions: u.permissions,
        allowedInvestorIds: u.allowed_investor_ids
      }));
    }
    
    res.json({ ...result, employees });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// ✅ ИСПРАВЛЕННЫЙ POST /api/data/:type - ВАЛИДАЦИЯ ТИПА
app.post('/api/data/:type', auth, async (req, res) => {
  try {
    const { type } = req.params;
    
    // 🔐 Валидация типа данных
    if (!VALID_DATA_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Недопустимый тип данных' });
    }
    
    const itemData = req.body;

    // ✅ Базовая логика: сотрудники → managerId, остальные → свой id
    let targetUserId = getTargetUserId(req.user);

    // ✅ СПЕЦИАЛЬНАЯ ЛОГИКА ДЛЯ ИНВЕСТОРОВ:
    // Если менеджер создаёт/обновляет профиль инвестора — сохраняем под ID инвестора
    if (type === 'investors' && itemData.id?.startsWith('u_inv_')) {
      targetUserId = itemData.id;  // ← Ключевое исправление!
    }

    // 🔐 Проверка прав доступа
    if (!canAccessUserData(req.user, targetUserId)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    const id = itemData.id;
    
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
    
    res.json(itemData);
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// ✅ ИСПРАВЛЕННЫЙ DELETE /api/data/:type/:id
app.delete('/api/data/:type/:id', auth, async (req, res) => {
  try {
    const { id, type } = req.params;

    if (!VALID_DATA_TYPES.includes(type)) {
      return res.status(400).json({ error: 'Недопустимый тип данных' });
    }

    let targetUserId = getTargetUserId(req.user);

    // ✅ Для инвесторов: удаляем только свои данные
    if (type === 'investors' && req.user.role === 'investor') {
      targetUserId = req.user.id;
    }
    
    if (!canAccessUserData(req.user, targetUserId)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    await pool.query('DELETE FROM data_items WHERE id = $1 AND user_id = $2', [id, targetUserId]);
    res.json({ success: true, id });
  } catch (err) {
    console.error(err);
    res.status(500).send('Server Error');
  }
});

// Wipe User Data (Reset)
app.delete('/api/user/data', auth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    
    if (!canAccessUserData(req.user, targetUserId)) {
      return res.status(403).json({ error: 'Доступ запрещён' });
    }
    
    await pool.query('DELETE FROM data_items WHERE user_id = $1', [targetUserId]);
    
    const accId = `acc_main_${targetUserId}`;
    const accData = { id: accId, userId: targetUserId, name: 'Основной счет', type: 'MAIN' };
    await pool.query(
      `INSERT INTO data_items (id, user_id, type, data) VALUES ($1, $2, $3, $4)`,
      [accId, targetUserId, 'accounts', JSON.stringify(accData)]
    );
    
    res.json({ success: true });
  } catch (err) {
    console.error("Reset Data Error:", err);
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
          req.user.id,
          JSON.stringify(permissions || {}),
          JSON.stringify(allowedInvestorIds || []),
          phone || null
        ]
      );
      
      return res.json({
        id, name, email, role, managerId: req.user.id, permissions, allowedInvestorIds, phone
      });
    }
    
    if (action === 'delete') {
  const investorId = userData.id;
  const managerId = req.user.id;

  // 1. Удаляем из users (всегда под manager_id)
  await pool.query('DELETE FROM users WHERE id = $1 AND manager_id = $2', [investorId, managerId]);

  // 2. ✅ Удаляем профиль инвестора (ищем в обоих местах)
  await pool.query(`
    DELETE FROM data_items 
    WHERE type = 'investors' 
    AND data->>'id' = $1 
    AND (user_id = $2 OR user_id = $1)  -- ← Проверяем и manager_id, и investor_id
  `, [investorId, managerId]);

  // 3. ✅ Удаляем счёт инвестора (ищем в обоих местах)
  await pool.query(`
    DELETE FROM data_items 
    WHERE type = 'accounts' 
    AND data->>'ownerId' = $1 
    AND (user_id = $2 OR user_id = $1)
  `, [investorId, managerId]);

  // 4. ✅ Удаляем операции инвестора (универсальный поиск)
  await pool.query(`
    DELETE FROM data_items 
    WHERE (user_id = $1 OR user_id = $2)  -- ← Проверяем оба user_id
    AND type IN ('sales', 'expenses')
    AND (
      data->>'accountId' = ANY(
        SELECT data->>'id' FROM data_items 
        WHERE type = 'accounts' AND data->>'ownerId' = $3
      )
      OR data->>'customerId' = $3
    )
  `, [managerId, investorId, investorId]);

  return res.json({ success: true, id: investorId });
}
    
    if (action === 'update') {
      const { id, name, email, permissions, allowedInvestorIds, password } = userData;
      
      await pool.query(`
        UPDATE users 
        SET name = $1, email = $2, permissions = $3, allowed_investor_ids = $4, updated_at = NOW()
        WHERE id = $5 AND manager_id = $6
      `, [name, email, JSON.stringify(permissions), JSON.stringify(allowedInvestorIds), id, req.user.id]);
      
      if (password && password.trim().length > 0) {
  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(password, salt);
  // ✅ Добавляем проверку manager_id
  await pool.query(
    'UPDATE users SET password = $1 WHERE id = $2 AND manager_id = $3',
    [hashedPassword, id, req.user.id]
  );
}
      
      return res.json({ success: true });
    }
    
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).send('Server Error');
  }
});

// --- ADMIN ROUTES ---
app.get('/api/admin/users', adminAuth, async (req, res) => {
  try {
    const query = `
      SELECT 
        u.id, u.name, u.email, u.role, u.phone, u.subscription, u.created_at, u.api_key,
        (SELECT COUNT(*) FROM data_items WHERE user_id = u.id AND type = 'sales') as sales_count
      FROM users u
      ORDER BY u.created_at DESC
    `;
    const result = await pool.query(query);
    
    const users = result.rows.map(r => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      phone: r.phone,
      subscription: r.subscription,
      salesCount: parseInt(r.sales_count || '0'),
      createdAt: r.created_at,
      apiKey: r.api_key
    }));
    
    res.json(users);
  } catch (e) {
    console.error("Admin fetch users error", e);
    res.status(500).send("Server Error");
  }
});

app.post('/api/admin/set-subscription', adminAuth, async (req, res) => {
  const { userId, plan, months } = req.body;
  
  try {
    const expiresAt = new Date();
    expiresAt.setMonth(expiresAt.getMonth() + Number(months));
    
    const subscription = {
      plan,
      expiresAt: expiresAt.toISOString()
    };
    
    await pool.query('UPDATE users SET subscription = $1 WHERE id = $2', [JSON.stringify(subscription), userId]);
    res.json({ success: true, subscription });
  } catch (e) {
    console.error("Admin set sub error", e);
    res.status(500).send("Server Error");
  }
});

app.post('/api/admin/generate-user-api-key', adminAuth, async (req, res) => {
  const { userId } = req.body;
  try {
    const newKey = `sk_${uuidv4().replace(/-/g, '')}`;
    await pool.query('UPDATE users SET api_key = $1 WHERE id = $2', [newKey, userId]);
    res.json({ apiKey: newKey });
  } catch (err) {
    console.error("Admin Generate API Key Error:", err);
    res.status(500).send('Server Error');
  }
});

// --- PAYMENTS (YooKassa) ---
app.post('/api/payment/create', auth, async (req, res) => {
  const { amount, description, returnUrl, plan, months } = req.body;
  const shopId = process.env.YOOKASSA_SHOP_ID;
  const secretKey = process.env.YOOKASSA_SECRET_KEY;
  
  if (!shopId || !secretKey) {
    console.log('[MOCK PAYMENT] Credentials missing.');
    return res.json({
      id: `mock_pay_${Date.now()}`,
      status: 'pending',
      confirmationUrl: returnUrl || 'https://yoomoney.ru'
    });
  }
  
  try {
    const idempotenceKey = uuidv4();
    const response = await axios.post('https://api.yookassa.ru/v3/payments', {
      amount: {
        value: amount.toFixed(2),
        currency: 'RUB'
      },
      capture: true,
      confirmation: {
        type: 'redirect',
        return_url: returnUrl
      },
      description: description,
      metadata: {
        userId: req.user.id,
        plan: plan,
        months: months
      }
    }, {
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${shopId}:${secretKey}`).toString('base64'),
        'Idempotence-Key': idempotenceKey,
        'Content-Type': 'application/json'
      }
    });
    
    res.json({
      id: response.data.id,
      status: response.data.status,
      confirmationUrl: response.data.confirmation.confirmation_url
    });
  } catch (error) {
    console.error('YooKassa Error:', error.response?.data || error.message);
    res.status(500).json({ msg: 'Payment creation failed' });
  }
});

// --- WEBHOOK HANDLER ---
app.post('/api/payment/webhook', async (req, res) => {
  const { event, object } = req.body;
  
  if (event === 'payment.succeeded' && object.status === 'succeeded') {
    const { userId, plan, months } = object.metadata;
    
    if (userId && plan && months) {
      try {
        const userResult = await pool.query('SELECT subscription FROM users WHERE id = $1', [userId]);
        let currentSub = userResult.rows[0]?.subscription || { plan: 'TRIAL', expiresAt: new Date().toISOString() };
        
        let newExpiresAt = new Date(currentSub.expiresAt);
        if (newExpiresAt < new Date()) {
          newExpiresAt = new Date();
        }
        newExpiresAt.setMonth(newExpiresAt.getMonth() + Number(months));
        
        const updatedSub = {
          plan: plan,
          expiresAt: newExpiresAt.toISOString()
        };
        
        await pool.query('UPDATE users SET subscription = $1 WHERE id = $2', [JSON.stringify(updatedSub), userId]);
        console.log(`[WEBHOOK] Updated subscription for user ${userId}: ${plan} for ${months} months`);
      } catch (err) {
        console.error('[WEBHOOK] Failed to update subscription', err);
        return res.status(500).send('DB Error');
      }
    }
  }
  res.status(200).send('OK');
});

// --- API KEY ROUTES ---
const apiKeyAuth = async (req, res, next) => {
  const apiKey = req.header('x-api-key');
  if (!apiKey) return res.status(401).json({ msg: 'No API key, authorization denied' });
  
  try {
    const result = await pool.query('SELECT * FROM users WHERE api_key = $1', [apiKey]);
    if (result.rows.length === 0) {
      return res.status(401).json({ msg: 'Invalid API key' });
    }
    req.user = result.rows[0];
    next();
  } catch (err) {
    console.error("API Key Auth Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
};

app.post('/api/auth/generate-api-key', auth, async (req, res) => {
  try {
    const newKey = `sk_${uuidv4().replace(/-/g, '')}`;
    await pool.query('UPDATE users SET api_key = $1 WHERE id = $2', [newKey, req.user.id]);
    res.json({ apiKey: newKey });
  } catch (err) {
    console.error("Generate API Key Error:", err);
    res.status(500).send('Server Error');
  }
});

// --- PUBLIC API V1 ---
// Все API V1 роуты также используют исправленную логику getTargetUserId

app.get('/api/v1/customers', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const result = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'customers'", [targetUserId]);
    const customers = result.rows.map(r => r.data);
    res.json(customers);
  } catch (err) {
    console.error("API Customers Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.post('/api/v1/customers', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const customerData = req.body;
    
    if (!customerData.name || !customerData.phone) {
      return res.status(400).json({ msg: 'Missing required fields: name, phone' });
    }
    
    const customerId = customerData.id || `cust_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    const newCustomer = {
      ...customerData,
      id: customerId,
      userId: targetUserId,
      trustScore: customerData.trustScore || 50,
      notes: customerData.notes || '',
      totalPurchases: 0
    };
    
    await pool.query(`
      INSERT INTO data_items (id, user_id, type, data, updated_at)
      VALUES ($1, $2, 'customers', $3, NOW())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [customerId, targetUserId, JSON.stringify(newCustomer)]);
    
    res.json(newCustomer);
  } catch (err) {
    console.error("API Create Customer Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.get('/api/v1/accounts', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    
    const accountsResult = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'accounts'", [targetUserId]);
    const salesResult = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'sales'", [targetUserId]);
    const expensesResult = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'expenses'", [targetUserId]);
    
    const accounts = accountsResult.rows.map(r => r.data);
    const sales = salesResult.rows.map(r => r.data);
    const expenses = expensesResult.rows.map(r => r.data);
    
    const accountsWithBalance = accounts.map(acc => {
      let total = 0;
      const accountSales = sales.filter(s => s.accountId === acc.id);
      accountSales.forEach(s => {
        total += (s.downPayment || 0);
        if (s.paymentPlan) {
          s.paymentPlan.filter(p => p.isPaid && p.isRealPayment !== false).forEach(p => total += (p.amount || 0));
        }
      });
      const accountExpenses = expenses.filter(e => e.accountId === acc.id);
      total -= accountExpenses.reduce((sum, e) => sum + (e.amount || 0), 0);
      
      return {
        ...acc,
        calculatedBalance: total
      };
    });
    
    res.json(accountsWithBalance);
  } catch (err) {
    console.error("API Accounts Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.post('/api/v1/income', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { amount, accountId, note, date } = req.body;
    
    if (!amount || !accountId) {
      return res.status(400).json({ msg: 'Missing required fields: amount, accountId' });
    }
    
    const incomeId = `inc_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newIncome = {
      id: incomeId,
      userId: targetUserId,
      type: 'CASH',
      customerId: 'system_income',
      productName: note || 'Приход через API',
      buyPrice: 0,
      accountId: accountId,
      totalAmount: Number(amount),
      downPayment: Number(amount),
      remainingAmount: 0,
      interestRate: 0,
      installments: 0,
      startDate: date || new Date().toISOString(),
      status: 'COMPLETED',
      paymentPlan: []
    };
    
    await pool.query(`
      INSERT INTO data_items (id, user_id, type, data, updated_at)
      VALUES ($1, $2, 'sales', $3, NOW())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [incomeId, targetUserId, JSON.stringify(newIncome)]);
    
    res.json(newIncome);
  } catch (err) {
    console.error("API Create Income Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.get('/api/v1/expenses', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const result = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'expenses'", [targetUserId]);
    const expenses = result.rows.map(r => r.data);
    res.json(expenses);
  } catch (err) {
    console.error("API Expenses Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.post('/api/v1/expenses', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { amount, accountId, title, category, date } = req.body;
    
    if (!amount || !accountId || !title) {
      return res.status(400).json({ msg: 'Missing required fields: amount, accountId, title' });
    }
    
    const expenseId = `exp_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const newExpense = {
      id: expenseId,
      userId: targetUserId,
      accountId: accountId,
      title: title,
      amount: Number(amount),
      category: category || 'Прочее',
      date: date || new Date().toISOString()
    };
    
    await pool.query(`
      INSERT INTO data_items (id, user_id, type, data, updated_at)
      VALUES ($1, $2, 'expenses', $3, NOW())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [expenseId, targetUserId, JSON.stringify(newExpense)]);
    
    res.json(newExpense);
  } catch (err) {
    console.error("API Create Expense Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.get('/api/v1/contracts', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const result = await pool.query("SELECT data FROM data_items WHERE user_id = $1 AND type = 'sales'", [targetUserId]);
    const sales = result.rows.map(r => r.data);
    res.json(sales);
  } catch (err) {
    console.error("API Contracts Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.post('/api/v1/contracts', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const saleData = req.body;
    
    if (!saleData.customerId || !saleData.totalAmount || !saleData.productName) {
      return res.status(400).json({ msg: 'Missing required fields: customerId, totalAmount, productName' });
    }
    
    const saleId = saleData.id || `sale_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    
    const newSale = {
      ...saleData,
      id: saleId,
      userId: targetUserId,
      status: saleData.status || 'ACTIVE',
      paymentPlan: saleData.paymentPlan || [],
      startDate: saleData.startDate || new Date().toISOString()
    };
    
    await pool.query(`
      INSERT INTO data_items (id, user_id, type, data, updated_at)
      VALUES ($1, $2, 'sales', $3, NOW())
      ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()
    `, [saleId, targetUserId, JSON.stringify(newSale)]);
    
    res.json(newSale);
  } catch (err) {
    console.error("API Create Contract Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

app.post('/api/v1/payments', apiKeyAuth, async (req, res) => {
  try {
    const targetUserId = getTargetUserId(req.user);
    const { contractId, amount, date } = req.body;
    
    if (!contractId || !amount) {
      return res.status(400).json({ msg: 'Missing contractId or amount' });
    }
    
    const saleResult = await pool.query("SELECT data FROM data_items WHERE id = $1 AND user_id = $2 AND type = 'sales'", [contractId, targetUserId]);
    if (saleResult.rows.length === 0) {
      return res.status(404).json({ msg: 'Contract not found' });
    }
    
    const sale = saleResult.rows[0].data;
    
    const payment = {
      id: `pay_${Date.now()}_api`,
      saleId: contractId,
      amount: Number(amount),
      date: date || new Date().toISOString(),
      isPaid: true,
      actualDate: new Date().toISOString()
    };
    
    sale.paymentPlan.push(payment);
    sale.remainingAmount = Math.max(0, sale.remainingAmount - Number(amount));
    if (sale.remainingAmount === 0) {
      sale.status = 'COMPLETED';
    }
    
    await pool.query(`
      UPDATE data_items SET data = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3
    `, [JSON.stringify(sale), contractId, targetUserId]);
    
    res.json({ msg: 'Payment processed', payment, remainingAmount: sale.remainingAmount });
  } catch (err) {
    console.error("API Payment Error:", err);
    res.status(500).json({ msg: 'Server Error' });
  }
});

// --- VITE MIDDLEWARE ---
const startServer = async () => {
  if (process.env.NODE_ENV !== 'production') {
    const viteModule = await import('vite');
    const vite = await viteModule.createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const path = require('path');
    app.use(express.static(path.join(__dirname, '../dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.join(__dirname, '../dist', 'index.html'));
    });
  }
  
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
};

startServer();