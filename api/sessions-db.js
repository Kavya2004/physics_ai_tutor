import { Router } from 'express';
import mongoose from 'mongoose';

// ── Models ────────────────────────────────────────────────────
const classSchema = new mongoose.Schema({
    className:     { type: String, required: true },
    professorName: { type: String, required: true },
    createdAt:     { type: Date, default: Date.now }
});

const sessionSchema = new mongoose.Schema({
    classId:   { type: mongoose.Schema.Types.ObjectId, ref: 'Class', required: true },
    sessionTitle: { type: String, required: true },
    createdBy: {
        name:  { type: String, required: true },
        email: { type: String, required: true }
    },
    status:    { type: String, enum: ['active', 'ended'], default: 'active' },
    students:  [{
        studentId:   String,
        name:        String,
        email:       { type: String, required: true },
        tableNumber: Number,
        joinedAt:    { type: Date, default: Date.now }
    }],
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

const Class   = mongoose.models.Class   || mongoose.model('Class',   classSchema);
const Session = mongoose.models.Session || mongoose.model('Session', sessionSchema);

// ── Router ────────────────────────────────────────────────────
const router = Router();

// POST /api/db/classes
router.post('/classes', async (req, res) => {
    try {
        const { className, professorName } = req.body;
        if (!className || !professorName) return res.status(400).json({ error: 'className and professorName required' });
        const cls = await Class.create({ className, professorName });
        res.status(201).json(cls);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/db/sessions
router.post('/sessions', async (req, res) => {
    try {
        const { classId, sessionTitle, createdBy } = req.body;
        if (!classId || !sessionTitle || !createdBy?.name || !createdBy?.email)
            return res.status(400).json({ error: 'classId, sessionTitle, and createdBy (name, email) required' });
        const session = await Session.create({ classId, sessionTitle, createdBy });
        res.status(201).json(session);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/db/sessions/:id/join
router.post('/sessions/:id/join', async (req, res) => {
    try {
        const session = await Session.findById(req.params.id);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        if (session.status === 'ended') return res.status(400).json({ error: 'Session has ended' });

        const { studentId, name, email, tableNumber } = req.body;
        if (!email) return res.status(400).json({ error: 'email required' });

        const duplicate = session.students.some(s => s.email === email);
        if (duplicate) return res.status(400).json({ error: 'Student already joined this session' });

        session.students.push({ studentId, name, email, tableNumber });
        session.updatedAt = new Date();
        await session.save();
        res.json(session);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /api/db/classes/:id/sessions
router.get('/classes/:id/sessions', async (req, res) => {
    try {
        const sessions = await Session.find({ classId: req.params.id }).sort({ createdAt: -1 });
        res.json(sessions);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// PATCH /api/db/sessions/:id/end
router.patch('/sessions/:id/end', async (req, res) => {
    try {
        const session = await Session.findByIdAndUpdate(
            req.params.id,
            { status: 'ended', updatedAt: new Date() },
            { new: true }
        );
        if (!session) return res.status(404).json({ error: 'Session not found' });
        res.json(session);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
