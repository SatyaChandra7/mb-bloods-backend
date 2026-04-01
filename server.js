const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const { google } = require('googleapis');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

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
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID || 'YOUR_SPREADSHEET_ID_HERE'; 

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

// Start Server
if (process.env.NODE_ENV !== 'production') {
    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
}
module.exports = app;
