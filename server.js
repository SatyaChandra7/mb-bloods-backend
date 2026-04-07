const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { Sequelize, DataTypes } = require('sequelize');

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
    : 'database.sqlite';

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
const JWT_SECRET = process.env.JWT_SECRET;
const ADMIN_USERS = [
    { username: process.env.ADMIN1_USER, password: process.env.ADMIN1_PASS },
    { username: process.env.ADMIN2_USER, password: process.env.ADMIN2_PASS }
];

// Serve static files (HTML, CSS, JS, Assets)
app.use(express.static(__dirname));

// Root route to serve index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Google Sheets Config
const SERVICE_ACCOUNT_FILE = 'service-account.json';
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

let sheets;
async function initializeGoogleSheets() {
    try {
        let auth;
        if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
            const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
            auth = new google.auth.GoogleAuth({
                credentials,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            sheets = google.sheets({ version: 'v4', auth });
            console.log('Google Sheets: Service Account (from env) initialized.');
        } else if (fs.existsSync(SERVICE_ACCOUNT_FILE)) {
            auth = new google.auth.GoogleAuth({
                keyFile: SERVICE_ACCOUNT_FILE,
                scopes: ['https://www.googleapis.com/auth/spreadsheets'],
            });
            sheets = google.sheets({ version: 'v4', auth });
            console.log('Google Sheets: Service Account file initialized.');
        } else if (process.env.GOOGLE_API_KEY) {
            sheets = google.sheets({ version: 'v4', auth: process.env.GOOGLE_API_KEY });
            console.log('Google Sheets: API Key initialized (Note: Append requires Service Account).');
        }

        if (sheets) {
            await syncSheetsToSQL();
        }
    } catch (err) {
        console.error('Failed to initialize Google Sheets:', err.message);
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
                // Find or create to prevent duplicates
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
            console.log(`✅ Synced ${rows.length} records from Google Sheets.`);
        }
    } catch (error) {
        console.error('Failed to sync from Google Sheets:', error.message);
    }
}

async function appendDonorToGoogleSheet(donor) {
    try {
        if (!sheets || !SPREADSHEET_ID) {
            console.warn('Google Sheets not initialized properly. Data NOT appended.');
            return;
        }
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
        console.log('✅ Appended to Google Sheets successfully');
    } catch (error) {
        console.error('❌ Google Sheets Append Error:', error.message);
    }
}

// Storage for "Our Work" Gallery
const UPLOAD_DIR = path.join(__dirname, 'assets', GALLERY_PATH);
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`)
});
const upload = multer({ storage });

// Multi-endpoint Auth Logic
const verifyAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
    if (!token) return res.status(403).json({ success: false, message: 'Access Denied: No token provided' });
    try {
        const verified = jwt.verify(token, JWT_SECRET);
        if (verified.role === 'admin') {
            req.user = verified;
            next();
        } else {
            res.status(403).json({ success: false, message: 'Access Denied: Not an admin' });
        }
    } catch (err) {
        res.status(401).json({ success: false, message: 'Invalid or Expired Token' });
    }
};

let currentAlert = null;

// API Endpoints
// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'Backend is running!' });
});

// Register Donor
app.post('/api/donors', async (req, res) => {
    try {
        const { fullName, dateOfBirth, gender, phoneNumber, bloodGroup, address } = req.body;

        const newDonor = await Donor.create({
            fullName,
            dateOfBirth,
            gender,
            phoneNumber,
            bloodGroup,
            state: address?.state || '',
            district: address?.district || '',
            mandal: address?.mandal || '',
            village: address?.village || ''
        });

        // Push to Google Sheets (Async)
        appendDonorToGoogleSheet(newDonor).catch(err => console.error('Sheet sync failed:', err));

        res.status(201).json({
            success: true,
            message: 'Donor registered successfully!',
            donor: newDonor
        });
    } catch (err) {
        console.error('Registration failed:', err);
        res.status(500).json({
            success: false,
            message: 'Internal server error. Please try again later.'
        });
    }
});

// Public Stats
app.get('/api/donations/count', (req, res) => {
    try {
        const images = fs.readdirSync(UPLOAD_DIR);
        res.json({ count: images.length });
    } catch (err) {
        res.json({ count: 0 });
    }
});

// Public Gallery
app.get('/api/public/gallery', (req, res) => {
    try {
        const images = fs.readdirSync(UPLOAD_DIR).filter(f => /\.(jpg|jpeg|png|gif)$/i.test(f));
        res.json({ success: true, images: images.map(img => `assets/${GALLERY_PATH}/${img}`) });
    } catch (err) {
        res.json({ success: false, images: [] });
    }
});

// Admin Login
app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    const admin = ADMIN_USERS.find(u => u.username === username && u.password === password);
    if (admin) {
        const token = jwt.sign({ username: admin.username, role: 'admin' }, JWT_SECRET, { expiresIn: '12h' });
        res.json({ success: true, token });
    } else {
        res.status(401).json({ success: false, message: 'Invalid Admin Credentials' });
    }
});

// Admin Image Upload
app.post('/api/admin/upload', verifyAdmin, upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });
    res.json({ success: true, filepath: `assets/${GALLERY_PATH}/${req.file.filename}` });
});

// Get Admin Donor Stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const allGroups = ['A+', 'A-', 'B+', 'B-', 'O+', 'O-', 'AB+', 'AB-'];
        const total = await Donor.count();
        
        const stats = await Promise.all(allGroups.map(async (group) => {
            const count = await Donor.count({ where: { bloodGroup: group } });
            return { group, count };
        }));
        
        res.json({ success: true, stats, total });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get Admin Donors (with filters)
app.get('/api/admin/donors', verifyAdmin, async (req, res) => {
    const { bloodGroup, address } = req.query;
    let whereClause = {};

    if (bloodGroup && bloodGroup !== 'All') {
        whereClause.bloodGroup = bloodGroup;
    }

    if (address) {
        const { Op } = require('sequelize');
        whereClause[Op.or] = [
            { state: { [Op.like]: `%${address}%` } },
            { district: { [Op.like]: `%${address}%` } },
            { mandal: { [Op.like]: `%${address}%` } },
            { village: { [Op.like]: `%${address}%` } }
        ];
    }

    try {
        const results = await Donor.findAll({
            where: whereClause,
            order: [['registeredAt', 'DESC']]
        });
        res.json({ success: true, donors: results });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Export Donors as CSV
app.get('/api/admin/export', verifyAdmin, async (req, res) => {
    try {
        const results = await Donor.findAll({ order: [['registeredAt', 'DESC']] });
        let csv = 'Full Name,DOB,Gender,Phone,Blood Group,State,District,Mandal,Village,Registered At\n';
        results.forEach(d => {
            csv += `"${d.fullName}","${d.dateOfBirth}","${d.gender || 'N/A'}","${d.phoneNumber}","${d.bloodGroup}","${d.state || ''}","${d.district || ''}","${d.mandal || ''}","${d.village || ''}","${new Date(d.registeredAt).toLocaleString()}"\n`;
        });
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=mb_bloods_donors.csv');
        res.status(200).send(csv);
    } catch (err) {
        res.status(500).send('Export failed');
    }
});

// Delete a Donor
app.get('/api/admin/donors/delete/:id', verifyAdmin, async (req, res) => {
    try {
        const deleted = await Donor.destroy({ where: { id: req.params.id } });
        if (deleted) res.json({ success: true, message: 'Donor deleted successfully' });
        else res.status(404).json({ success: false, message: 'Donor not found' });
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Toggle Verification
app.get('/api/admin/donors/verify/:id', verifyAdmin, async (req, res) => {
    try {
        const donor = await Donor.findByPk(req.params.id);
        if (donor) {
            donor.isVerified = !donor.isVerified;
            await donor.save();
            res.json({ success: true, isVerified: donor.isVerified });
        } else {
            res.status(404).json({ success: false, message: 'Donor not found' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Emergency Alert
app.post('/api/admin/alerts', verifyAdmin, (req, res) => {
    const { message, isActive } = req.body;
    currentAlert = { message, isActive, createdAt: new Date() };
    res.json({ success: true, alert: currentAlert });
});

app.get('/api/public/alert', (req, res) => {
    if (currentAlert && currentAlert.isActive) res.json({ success: true, alert: currentAlert });
    else res.json({ success: true, alert: null });
});

// Public Search
app.get('/api/public/donors', async (req, res) => {
    const { bloodGroup, address } = req.query;
    let whereClause = {};

    if (bloodGroup && bloodGroup !== 'All') {
        whereClause.bloodGroup = bloodGroup;
    }

    if (address) {
        const { Op } = require('sequelize');
        whereClause[Op.or] = [
            { state: { [Op.like]: `%${address}%` } },
            { district: { [Op.like]: `%${address}%` } },
            { mandal: { [Op.like]: `%${address}%` } },
            { village: { [Op.like]: `%${address}%` } }
        ];
    }

    try {
        const results = await Donor.findAll({
            where: whereClause,
            order: [['registeredAt', 'DESC']],
            limit: 50
        });
        res.json({ success: true, donors: results });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Search failed' });
    }
});

// Initialize Database and Start Server
async function startApp() {
    try {
        await sequelize.authenticate();
        console.log('✅ SQL Database connected.');
        await sequelize.sync(); // Create tables if not exist
        await initializeGoogleSheets();
        
        if (process.env.NODE_ENV !== 'production') {
            app.listen(PORT, () => {
                console.log(`✅ Server is running on port ${PORT}`);
            });
        }
    } catch (err) {
        console.error('Unable to connect to the database:', err);
    }
}

startApp();

module.exports = app;
