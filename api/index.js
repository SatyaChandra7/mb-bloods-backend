// Error handling for unhandled rejections/exceptions
process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes, Op } = require('sequelize');

const app = express();
const PORT = process.env.PORT || 5000;
const SHEET_NAME = process.env.GOOGLE_SHEET_NAME || 'Sheet1';
const GALLERY_PATH = process.env.GALLERY_FOLDER || 'our work';

// Middleware
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

// SQL Database Initialization (Sequelize + SQLite)
const dbPath = process.env.NODE_ENV === 'production' 
    ? path.join('/tmp', 'database.sqlite') 
    : path.join(__dirname, '..', 'database.sqlite');

const sequelize = new Sequelize({
    dialect: 'sqlite',
    storage: dbPath,
    logging: false
});

// Donor Model
const Donor = sequelize.define('Donor', {
    fullName: { type: DataTypes.STRING, allowNull: false },
    dateOfBirth: DataTypes.DATEONLY,
    gender: DataTypes.STRING,
    phoneNumber: { type: DataTypes.STRING, allowNull: false },
    bloodGroup: { type: DataTypes.STRING, allowNull: false },
    state: DataTypes.STRING,
    district: DataTypes.STRING,
    mandal: DataTypes.STRING,
    village: DataTypes.STRING,
    registeredAt: { type: DataTypes.DATE, defaultValue: DataTypes.NOW },
    isVerified: { type: DataTypes.BOOLEAN, defaultValue: false }
});

// Admin Config
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-for-dev';
const ADMIN_USERS = [
    { username: process.env.ADMIN1_USER, password: process.env.ADMIN1_PASS },
    { username: process.env.ADMIN2_USER, password: process.env.ADMIN2_PASS }
].filter(u => u.username && u.password);

// Serve static files (HTML, CSS, JS, Assets)
app.use(express.static(path.join(__dirname, '..')));

// Root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'index.html'));
});

// Google Sheets Config
const SERVICE_ACCOUNT_FILE = path.join(__dirname, '..', 'service-account.json');
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

let sheets;
let isInitialized = false;

async function initializeApp() {
    if (isInitialized) return;
    try {
        // Auth with DB
        await sequelize.authenticate();
        await sequelize.sync();
        
        // Auth with Google
        let auth;
        if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
            try {
                const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
                auth = new google.auth.GoogleAuth({
                    credentials,
                    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
                });
                sheets = google.sheets({ version: 'v4', auth });
                console.log('Google Sheets: Service Account (from env) initialized.');
            } catch (e) {
                console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', e.message);
            }
        } else if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
            auth = new google.auth.GoogleAuth({
                keyFile: SERVICE_ACCOUNT_FILE,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            sheets = google.sheets({ version: 'v4', auth });
            console.log('Google Sheets: Service Account file initialized.');
        }

        if (sheets && SPREADSHEET_ID) {
            await syncSheetsToSQL();
        }
        isInitialized = true;
    } catch (err) {
        console.error('Initialization error:', err.message);
    }
}

async function syncSheetsToSQL() {
    try {
        if (!sheets || !SPREADSHEET_ID) return;
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A2:J`, 
        });
        const rows = response.data.values;
        if (rows && rows.length > 0) {
            for (const row of rows) {
                await Donor.findOrCreate({
                    where: { phoneNumber: row[3], fullName: row[0] },
                    defaults: {
                        dateOfBirth: row[1],
                        gender: row[2] || 'Not specified',
                        bloodGroup: row[4],
                        state: row[5],
                        district: row[6],
                        mandal: row[7],
                        village: row[8],
                        registeredAt: row[9] ? new Date(row[9]) : new Date(),
                        isVerified: false
                    }
                });
            }
            console.log(`✅ Synced ${rows.length} records.`);
        }
    } catch (error) {
        console.error('Sync Error:', error.message);
    }
}

async function appendDonorToGoogleSheet(donor) {
    try {
        if (!sheets || !SPREADSHEET_ID) return;
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:J`,
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    donor.fullName,
                    donor.dateOfBirth,
                    donor.gender,
                    donor.phoneNumber,
                    donor.bloodGroup,
                    donor.state || '',
                    donor.district || '',
                    donor.mandal || '',
                    donor.village || '',
                    new Date().toLocaleString()
                ]]
            }
        });
    } catch (error) {
        console.error('Google Sheets Append Error:', error.message);
    }
}

// Ensure initialization happens for every request if not ready
app.use(async (req, res, next) => {
    if (!isInitialized && req.path.startsWith('/api')) {
        await initializeApp();
    }
    next();
});

// Storage for "Our Work" Gallery
const UPLOAD_DIR = path.join(process.env.NODE_ENV === 'production' ? '/tmp' : path.join(__dirname, '..'), 'assets', GALLERY_PATH);
if (!fs.existsSync(UPLOAD_DIR)) {
    try {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    } catch (e) {
        console.error('Failed to create upload dir:', e.message);
    }
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Verification Middleware
const verifyAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
    if (!token) return res.status(403).json({ success: false, message: 'No token' });
    try {
        const verified = jwt.verify(token, JWT_SECRET);
        if (verified.role === 'admin') {
            req.user = verified;
            next();
        } else {
            res.status(403).json({ success: false, message: 'Not admin' });
        }
    } catch (err) {
        res.status(401).json({ success: false, message: 'Invalid token' });
    }
};

let currentAlert = null;

// API Endpoints
app.get('/health', (req, res) => res.json({ status: 'ok', initialized: isInitialized }));

app.post('/api/donors', async (req, res) => {
    try {
        const { fullName, dateOfBirth, gender, phoneNumber, bloodGroup, address } = req.body;
        const newDonor = await Donor.create({
            fullName, dateOfBirth, gender, phoneNumber, bloodGroup,
            state: address?.state || '',
            district: address?.district || '',
            mandal: address?.mandal || '',
            village: address?.village || ''
        });
        appendDonorToGoogleSheet(newDonor).catch(console.error);
        res.status(201).json({ success: true, donor: newDonor });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/donations/count', async (req, res) => {
    try {
        const count = await Donor.count();
        res.json({ count });
    } catch (err) {
        res.json({ count: 0 });
    }
});

app.get('/api/public/gallery', (req, res) => {
    try {
        const files = fs.readdirSync(UPLOAD_DIR).filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
        res.json({ success: true, images: files.map(img => `assets/${GALLERY_PATH}/${img}`) });
    } catch (err) {
        res.json({ success: false, images: [] });
    }
});

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const admin = ADMIN_USERS.find(u => u.username === username && u.password === password);
    if (admin) {
        const token = jwt.sign({ username: admin.username, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid' });
    }
});

app.post('/api/admin/upload', verifyAdmin, upload.single('image'), (req, res) => {
    res.json({ success: true, filepath: `assets/${GALLERY_PATH}/${req.file.filename}` });
});

app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
    try {
        const groups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
        const stats = await Promise.all(groups.map(async (g) => ({ group: g, count: await Donor.count({ where: { bloodGroup: g } }) })));
        res.json({ success: true, stats, total: await Donor.count() });
    } catch (err) {
        res.status(500).json({ success: false });
    }
});

app.get('/api/admin/donors', verifyAdmin, async (req, res) => {
    const { bloodGroup, address } = req.query;
    let where = {};
    if (bloodGroup && bloodGroup !== 'All') where.bloodGroup = bloodGroup;
    if (address) {
        where[Op.or] = [
            { state: { [Op.like]: `%${address}%` } },
            { district: { [Op.like]: `%${address}%` } },
            { mandal: { [Op.like]: `%${address}%` } },
            { village: { [Op.like]: `%${address}%` } }
        ];
    }
    const results = await Donor.findAll({ where, order: [['registeredAt', 'DESC']] });
    res.json({ success: true, donors: results });
});

app.get('/api/admin/donors/delete/:id', verifyAdmin, async (req, res) => {
    await Donor.destroy({ where: { id: req.params.id } });
    res.json({ success: true });
});

app.get('/api/admin/export', verifyAdmin, async (req, res) => {
    try {
        const donors = await Donor.findAll({ order: [['registeredAt', 'DESC']] });
        let csv = 'Full Name,DOB,Gender,Phone,Blood Group,State,District,Mandal,Village,Registered At,Verified\n';
        donors.forEach(d => {
            csv += `"${d.fullName}","${d.dateOfBirth}","${d.gender}","${d.phoneNumber}","${d.bloodGroup}","${d.state}","${d.district}","${d.mandal}","${d.village}","${d.registeredAt}",${d.isVerified}\n`;
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=mb-bloods-donors.csv');
        res.status(200).send(csv);
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

app.get('/api/admin/donors/verify/:id', verifyAdmin, async (req, res) => {
    const donor = await Donor.findByPk(req.params.id);
    if (donor) {
        donor.isVerified = !donor.isVerified;
        await donor.save();
        res.json({ success: true, isVerified: donor.isVerified });
    } else res.status(404).json();
});

app.post('/api/admin/alerts', verifyAdmin, (req, res) => {
    currentAlert = { ...req.body, createdAt: new Date() };
    res.json({ success: true });
});

app.get('/api/public/alert', (req, res) => res.json({ success: true, alert: currentAlert?.isActive ? currentAlert : null }));

app.get('/api/public/donors', async (req, res) => {
    const { bloodGroup, address } = req.query;
    let where = {};
    if (bloodGroup && bloodGroup !== 'All') where.bloodGroup = bloodGroup;
    if (address) {
        where[Op.or] = [
            { state: { [Op.like]: `%${address}%` } },
            { district: { [Op.like]: `%${address}%` } },
            { mandal: { [Op.like]: `%${address}%` } },
            { village: { [Op.like]: `%${address}%` } }
        ];
    }
    const results = await Donor.findAll({ where, order: [['registeredAt', 'DESC']], limit: 50 });
    res.json({ success: true, donors: results });
});

// For local development
if (process.env.NODE_ENV !== 'production') {
    initializeApp().then(() => {
        app.listen(PORT, () => console.log(`Server on ${PORT}`));
    });
}

module.exports = app;
