const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

// Admin Config
const JWT_SECRET = process.env.JWT_SECRET || 'mbbloods-super-secret-key-123';
const ADMIN_USERS = [
    { username: process.env.ADMIN1_USER || 'admin1', password: process.env.ADMIN1_PASS || 'admin123' },
    { username: process.env.ADMIN2_USER || 'admin2', password: process.env.ADMIN2_PASS || 'admin234' }
];

// Middleware
app.use(cors({
    origin: process.env.CORS_ORIGIN || '*'
}));
app.use(express.json());

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB!'))
    .catch((err) => console.error('MongoDB connection error:', err));

// Google Sheets Config
const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'AIzaSyBvF18DbnlWTVb6D_FQf5DatSOPXtoz92c';
// Note: You must put your actual spreadsheet ID here (found in your Google Sheets URL)
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || '1E2g-qu5tpzv5npT7h0Q7_wFVhIr1AANehi_UdKH4wLw';

const sheets = google.sheets({ version: 'v4', auth: GOOGLE_API_KEY });

async function appendDonorToGoogleSheet(donor) {
    try {
        // Warning: Writing to Google Sheets via API Key will likely return a 401 error.
        // Google requires OAuth2 or Service Accounts (JSON file) to append data.
        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Sheet1!A:I', // Make sure you have a Tab named 'Sheet1'
            valueInputOption: 'USER_ENTERED',
            requestBody: {
                values: [[
                    donor.fullName,
                    new Date(donor.dateOfBirth).toLocaleDateString(),
                    donor.phoneNumber,
                    donor.bloodGroup,
                    donor.address?.state || '',
                    donor.address?.district || '',
                    donor.address?.mandal || '',
                    donor.address?.village || '',
                    new Date().toLocaleString() // Registered At
                ]]
            }
        });
        console.log('Appended to Google Sheets successfully');
    } catch (error) {
        console.error('Google Sheets API Error (Write access typically requires Service Account):', error.message);
    }
}

// Donor Schema
const donorSchema = new mongoose.Schema({
    fullName: { type: String, required: true },
    dateOfBirth: { type: Date, required: true },
    phoneNumber: { type: String, required: true },
    bloodGroup: { type: String, required: true },
    address: {
        state: String,
        district: String,
        mandal: String,
        village: String
    },
    registeredAt: { type: Date, default: Date.now }
});

const Donor = mongoose.model('Donor', donorSchema);

// API Endpoints
// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'Backend is running!' });
});

// Register Donor
app.post('/api/donors', async (req, res) => {
    try {
        const { fullName, dateOfBirth, phoneNumber, bloodGroup, address } = req.body;

        const newDonor = new Donor({
            fullName,
            dateOfBirth,
            phoneNumber,
            bloodGroup,
            address
        });

        await newDonor.save();

        // Push to Google Sheets asynchronously (so user doesn't have to wait for it)
        appendDonorToGoogleSheet(newDonor);

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

// Get Donor Count
app.get('/api/donors/count', async (req, res) => {
    try {
        const count = await Donor.countDocuments();
        res.json({ count });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Could not fetch count' });
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

// Admin Auth Middleware
const verifyAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(403).json({ success: false, message: 'Access Denied: No token provided' });

    const token = authHeader.split(' ')[1];
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

// Get Admin Donors (with filters)
app.get('/api/admin/donors', verifyAdmin, async (req, res) => {
    try {
        const { bloodGroup, address } = req.query;
        let filter = {};

        if (bloodGroup && bloodGroup !== 'All') {
            filter.bloodGroup = bloodGroup;
        }

        if (address) {
            const regex = new RegExp(address, 'i');
            filter.$or = [
                { 'address.state': regex },
                { 'address.district': regex },
                { 'address.mandal': regex },
                { 'address.village': regex }
            ];
        }

        const donors = await Donor.find(filter).sort({ registeredAt: -1 });
        res.json({ success: true, donors });
    } catch (err) {
        console.error('Admin donors fetch error:', err);
        res.status(500).json({ success: false, message: 'Server Error filtering donors' });
    }
});

// Start Server
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
module.exports = app;
