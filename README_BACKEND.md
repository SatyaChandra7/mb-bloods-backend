# Mahesh Babu Bloods Backend Setup

This backend is built using **Node.js**, **Express.js**, and **MongoDB** to handle donor registration and data persistence.

## Prerequisites
1.  **Node.js**: [Download and Install Node.js](https://nodejs.org/).
2.  **MongoDB**: [Download and Install MongoDB Community Server](https://www.mongodb.com/try/download/community) or use [MongoDB Atlas](https://www.mongodb.com/atlas/database) for a cloud database.

## Setup Instructions
1.  Open your terminal and navigate to the project directory:
    ```bash
    cd "d:\mb bloods"
    ```
2.  Install the required dependencies:
    ```bash
    npm install
    ```
3.  Configure your database connection:
    - Open the `.env` file in the root directory.
    - Update `MONGODB_URI` with your connection string (e.g., `mongodb://localhost:27017/mb-bloods`).
4.  Start the backend server:
    ```bash
    npm start
    ```
    Your backend should now be running on `http://localhost:5000`.

## API Endpoints
- **GET** `/health`: Check if the server is active.
- **POST** `/api/donors`: Register a new donor (expects `fullName`, `dateOfBirth`, `phoneNumber`, `bloodGroup`, `address`).
- **GET** `/api/donors/count`: Retrieve the total number of registered donors.

## Connecting Frontend
The frontend is already configured to communicate with this backend. Ensure both are running simultaneously for registration to work.
