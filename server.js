const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
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
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
