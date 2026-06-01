import mongoose from 'mongoose';

let connected = false;

export async function connectMongo() {
    if (connected) return;
    const uri = process.env.MONGODB_URI;
    if (!uri) { console.warn('MONGODB_URI not set — skipping MongoDB connection'); return; }
    await mongoose.connect(uri);
    connected = true;
    console.log('MongoDB connected');
}
