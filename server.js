const express = require('express');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 4200;
const JWT_SECRET = process.env.JWT_SECRET || 'secret'; // Use environment variable in production

// Middleware
app.use(cors({
    origin: [
        'http://localhost:3000', // For local development
        'https://3d-campus-tour.netlify.app', // Replace with your deployed frontend URL
        'http://localhost:4200' // If testing locally with a different port
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
}));
app.use(bodyParser.json());
app.use(express.static('public')); // Serve static files (e.g., .glb models, assets)

// MongoDB Atlas Connection
mongoose.connect('mongodb+srv://campusUser:XUaQLcvYPCtRjUZJ@cluster0.gmgp4nb.mongodb.net/campus_tour?retryWrites=true&w=majority&appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true
}).then(async () => {
    console.log('Connected to MongoDB Atlas');
    const buildings = await Building.find();
    console.log('Existing buildings:', buildings);
}).catch((err) => {
    console.error('MongoDB Atlas connection error:', err);
});

// User Schema
const userSchema = new mongoose.Schema({
    fullName: { type: String },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },
    rememberMe: { type: Boolean, default: false }
});
const User = mongoose.model('User', userSchema);

// Building Schema
const buildingSchema = new mongoose.Schema({
    name: { type: String, required: true },
    description: { type: String, required: true },
    modelPath: { type: String }
});
const Building = mongoose.model('Building', buildingSchema);

// Event Schema
const eventSchema = new mongoose.Schema({
    name: { type: String, required: true },
    date: { type: Date, required: true }
});
const Event = mongoose.model('Event', eventSchema);

// Hotspot Schema
const hotspotSchema = new mongoose.Schema({
    buildingModel: { type: String, required: true }, // Path to .glb model
    position: {
        x: { type: Number, required: true },
        y: { type: Number, required: true },
        z: { type: Number, required: true }
    },
    content: { type: String }
});
const Hotspot = mongoose.model('Hotspot', hotspotSchema);

// Middleware to verify JWT
const authenticate = async (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        console.error('Token verification error:', error);
        res.status(401).json({ message: 'Invalid token' });
    }
};

// Middleware to check admin role
const isAdmin = (req, res, next) => {
    if (req.user.role !== 'admin') {
        return res.status(403).json({ message: 'Admin access required' });
    }
    next();
};

// Create default admin user
async function createDefaultAdmin() {
    const adminExists = await User.findOne({ email: 'admin@campus.edu' });
    if (!adminExists) {
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await User.create({
            fullName: 'Admin',
            email: 'admin@campus.edu',
            password: hashedPassword,
            role: 'admin',
            rememberMe: false
        });
        console.log('Default admin created: admin@campus.edu / admin123');
    } else {
        console.log('Admin user already exists:', adminExists.email);
    }
}
createDefaultAdmin();

// Register User
app.post('/api/register', async (req, res) => {
    try {
        const { fullName, email, password, role } = req.body;
        console.log('Register attempt:', { email });
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.status(400).json({ message: 'User already exists' });
        }
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({
            fullName,
            email,
            password: hashedPassword,
            role: role || 'user',
            rememberMe: false
        });
        await user.save();
        res.status(201).json({ message: 'User registered successfully' });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Login User
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, rememberMe } = req.body;
        console.log('Login attempt:', { email });
        const user = await User.findOne({ email });
        if (!user) {
            console.log('User not found:', email);
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        const isMatch = await bcrypt.compare(password, user.password);
        console.log('Password match:', isMatch);
        if (!isMatch) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }
        const token = jwt.sign(
            { id: user._id, email: user.email, role: user.role },
            JWT_SECRET,
            { expiresIn: '1h' }
        );
        user.rememberMe = rememberMe || false;
        await user.save();
        res.json({
            message: 'Login successful',
            token,
            user: {
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                rememberMe: user.rememberMe
            }
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get User Profile
app.get('/api/user/:email', authenticate, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.params.email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({
            fullName: user.fullName,
            email: user.email,
            role: user.role,
            rememberMe: user.rememberMe
        });
    } catch (error) {
        console.error('Get user error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update User Profile
app.put('/api/user/:email', authenticate, async (req, res) => {
    try {
        const { fullName, password, rememberMe } = req.body;
        const updateData = {};
        if (fullName) updateData.fullName = fullName;
        if (password) updateData.password = await bcrypt.hash(password, 10);
        if (typeof rememberMe === 'boolean') updateData.rememberMe = rememberMe;
        const user = await User.findOneAndUpdate(
            { email: req.params.email },
            updateData,
            { new: true }
        );
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({
            message: 'Profile updated successfully',
            user: {
                fullName: user.fullName,
                email: user.email,
                role: user.role,
                rememberMe: user.rememberMe
            }
        });
    } catch (error) {
        console.error('Update user error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete User
app.delete('/api/user/:email', authenticate, async (req, res) => {
    try {
        const user = await User.findOneAndDelete({ email: req.params.email });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        res.json({ message: 'User deleted successfully' });
    } catch (error) {
        console.error('Delete user error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all buildings
app.get('/api/buildings', authenticate, async (req, res) => {
    try {
        const buildings = await Building.find();
        console.log('Returning buildings:', buildings);
        res.json(buildings);
    } catch (error) {
        console.error('Get buildings error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Add building (admin only)
app.post('/api/buildings', authenticate, isAdmin, async (req, res) => {
    try {
        const { name, description, modelPath } = req.body;
        console.log('Adding building:', { name, description, modelPath });
        const building = new Building({ name, description, modelPath });
        await building.save();
        res.status(201).json(building);
    } catch (error) {
        console.error('Add building error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update building (admin only)
app.put('/api/buildings/:id', authenticate, isAdmin, async (req, res) => {
    try {
        const { name, description, modelPath } = req.body;
        console.log('Updating building:', { id: req.params.id, name, description, modelPath });
        const building = await Building.findByIdAndUpdate(
            req.params.id,
            { name, description, modelPath },
            { new: true }
        );
        if (!building) {
            return res.status(404).json({ message: 'Building not found' });
        }
        res.json(building);
    } catch (error) {
        console.error('Update building error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete building (admin only)
app.delete('/api/buildings/:id', authenticate, isAdmin, async (req, res) => {
    try {
        const building = await Building.findByIdAndDelete(req.params.id);
        console.log('Deleting building:', req.params.id);
        if (!building) {
            return res.status(404).json({ message: 'Building not found' });
        }
        await Hotspot.deleteMany({ buildingModel: building.modelPath });
        res.json({ message: 'Building deleted successfully' });
    } catch (error) {
        console.error('Delete building error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get all events
app.get('/api/events', authenticate, async (req, res) => {
    try {
        const events = await Event.find();
        console.log('Returning events:', events);
        res.json(events);
    } catch (error) {
        console.error('Get events error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Add event (admin only)
app.post('/api/events', authenticate, isAdmin, async (req, res) => {
    try {
        const { name, date } = req.body;
        console.log('Adding event:', { name, date });
        const event = new Event({ name, date });
        await event.save();
        res.status(201).json(event);
    } catch (error) {
        console.error('Add event error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete event (admin only)
app.delete('/api/events/:id', authenticate, isAdmin, async (req, res) => {
    try {
        const event = await Event.findByIdAndDelete(req.params.id);
        console.log('Deleting event:', req.params.id);
        if (!event) {
            return res.status(404).json({ message: 'Event not found' });
        }
        res.json({ message: 'Event deleted successfully' });
    } catch (error) {
        console.error('Delete event error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Get hotspots for a building
app.get('/api/hotspots/building/:modelPath', authenticate, async (req, res) => {
    try {
        const modelPath = decodeURIComponent(req.params.modelPath);
        const hotspots = await Hotspot.find({ buildingModel: modelPath });
        console.log('Returning hotspots for model:', modelPath, hotspots);
        res.json(hotspots);
    } catch (error) {
        console.error('Get hotspots error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Add hotspot (admin only)
app.post('/api/hotspots', authenticate, isAdmin, async (req, res) => {
    try {
        const { buildingModel, position, content } = req.body;
        console.log('Adding hotspot:', { buildingModel, position, content });
        if (!buildingModel || !position || !position.x || !position.y || !position.z) {
            return res.status(400).json({ message: 'Invalid hotspot data' });
        }
        const hotspot = new Hotspot({
            buildingModel,
            position,
            content
        });
        await hotspot.save();
        res.status(201).json(hotspot);
    } catch (error) {
        console.error('Add hotspot error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Update hotspot (admin only)
app.put('/api/hotspots/:id', authenticate, isAdmin, async (req, res) => {
    try {
        const { position, content } = req.body;
        console.log('Updating hotspot:', { id: req.params.id, position, content });
        const updateData = {};
        if (position) {
            if (!position.x || !position.y || !position.z) {
                return res.status(400).json({ message: 'Invalid position data' });
            }
            updateData.position = position;
        }
        if (content !== undefined) updateData.content = content;
        const hotspot = await Hotspot.findByIdAndUpdate(
            req.params.id,
            updateData,
            { new: true }
        );
        if (!hotspot) {
            return res.status(404).json({ message: 'Hotspot not found' });
        }
        res.json(hotspot);
    } catch (error) {
        console.error('Update hotspot error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete hotspot (admin only)
app.delete('/api/hotspots/:id', authenticate, isAdmin, async (req, res) => {
    try {
        const hotspot = await Hotspot.findByIdAndDelete(req.params.id);
        console.log('Deleting hotspot:', req.params.id);
        if (!hotspot) {
            return res.status(404).json({ message: 'Hotspot not found' });
        }
        res.json({ message: 'Hotspot deleted successfully' });
    } catch (error) {
        console.error('Delete hotspot error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Delete all hotspots for a building (admin only)
app.delete('/api/hotspots/building/:modelPath', authenticate, isAdmin, async (req, res) => {
    try {
        const modelPath = decodeURIComponent(req.params.modelPath);
        console.log('Deleting all hotspots for model:', modelPath);
        await Hotspot.deleteMany({ buildingModel: modelPath });
        res.json({ message: 'All hotspots deleted successfully' });
    } catch (error) {
        console.error('Delete all hotspots error:', error);
        res.status(500).json({ message: 'Server error' });
    }
});

// Catch-all route for unknown endpoints
app.use((req, res) => {
    res.status(404).json({ message: 'Endpoint not found' });
});

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
