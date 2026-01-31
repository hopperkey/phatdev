const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

const DB_FILE = './database.json';

let db = {
    admins: ["1279324001180844085"], 
    supports: ["1279324001180844085"],
    applications: [],
    keys: []
};

const loadDB = () => {
    if (fs.existsSync(DB_FILE)) {
        try {
            const data = fs.readFileSync(DB_FILE, 'utf8');
            const parsed = JSON.parse(data);
            db.admins = parsed.admins || ["1279324001180844085"];
            db.supports = parsed.supports || [];
            db.applications = parsed.applications || [];
            db.keys = parsed.keys || [];
        } catch (e) {
            console.log("⚠️ Lỗi đọc file database.");
        }
    }
};

const saveDB = () => {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 4));
    } catch (e) {
        console.error("❌ Không thể lưu database:", e);
    }
};

loadDB();

app.post('/auth', (req, res) => {
    const body = req.body;
    const action = body.action;
    const userId = body.user_id || body.userId || "Guest";

    console.log(`[${new Date().toLocaleTimeString()}] Action: ${action} | User: ${userId}`);

    switch (action) {
        case 'test':
            return res.json({ success: true });

        // --- THÊM: GET ANALYTICS (Cho các ô thống kê Dashboard) ---
        case 'get_analytics':
            const now = new Date();
            return res.json({
                success: true,
                total_keys: db.keys.length,
                active_keys: db.keys.filter(k => k.hwid && !k.banned && new Date(k.expires_at) > now).length,
                banned_keys: db.keys.filter(k => k.banned).length,
                expired_keys: db.keys.filter(k => new Date(k.expires_at) < now).length,
                total_apps: db.applications.length
            });

        // --- THÊM: GET USERS (Cho tab Danh sách User) ---
        case 'get_users':
            const userList = db.keys
                .filter(k => k.hwid) // Chỉ lấy những key đã có máy sử dụng
                .map(k => ({
                    user_id: k.hwid,
                    key_used: k.key,
                    system_info: k.system_info || "Android Device",
                    last_login: k.created_at,
                    status: k.banned ? "Banned" : (new Date(k.expires_at) < new Date() ? "Expired" : "Active")
                }));
            return res.json({ success: true, users: userList });

        case 'check_support':
            const isSupport = db.supports.includes(userId) || db.admins.includes(userId);
            return res.json({ success: true, is_support: isSupport });

        case 'check_permission':
            const isAdmin = db.admins.includes(userId);
            return res.json({ success: true, is_admin: isAdmin, app_count: db.applications.length });

        case 'get_apps':
            return res.json({ success: true, applications: db.applications });

        case 'create_app':
            const newApp = {
                name: body.app_name,
                api_key: "AK-" + Math.random().toString(36).substring(2, 12).toUpperCase(),
                created_by: userId,
                created_at: new Date().toISOString()
            };
            db.applications.push(newApp);
            saveDB();
            return res.json({ success: true });

        case 'delete_app':
            db.applications = db.applications.filter(a => a.name !== body.app_name);
            db.keys = db.keys.filter(k => k.api !== body.api);
            saveDB();
            return res.json({ success: true });

        case 'get_keys':
            const filteredKeys = body.api ? db.keys.filter(k => k.api === body.api) : db.keys;
            const processedKeys = filteredKeys.map(k => {
                let currentStatus = "Inactive";
                if (k.banned) currentStatus = "Banned";
                else if (new Date(k.expires_at) < new Date()) currentStatus = "Expired";
                else if (k.hwid) currentStatus = "Active"; 

                return { ...k, status: currentStatus };
            });
            return res.json({ success: true, keys: processedKeys });

        case 'check_key':
            const keyDetails = db.keys.find(k => k.key === body.key);
            if (!keyDetails) return res.json({ success: false, message: "Key not found!" });
            const viewStatus = keyDetails.banned ? "Banned" : (keyDetails.hwid ? "Active" : "Inactive");
            return res.json({ success: true, key: { ...keyDetails, status: viewStatus } });

        case 'create_key':
            const newKey = {
                key: (body.prefix || "VIP") + "-" + Math.random().toString(36).substring(2, 10).toUpperCase(),
                api: body.api,
                prefix: body.prefix || "VIP",  // ⬅️ THÊM
                created_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + (body.days * 86400000)).toISOString(),
                device_limit: parseInt(body.device_limit) || 1,
                hwids: [],
                hwid: null,
                system_info: "No Device Connected",
                used: false,
                banned: false
            };
            db.keys.push(newKey);
            saveDB();
            return res.json({ success: true, key: newKey.key });

        case 'delete_key':
            db.keys = db.keys.filter(k => k.key !== body.key);
            saveDB();
            return res.json({ success: true });

        case 'reset_hwid':
            const kToReset = db.keys.find(k => k.key === body.key);
            if (kToReset) {
                kToReset.hwids = [];
                kToReset.hwid = null;
                kToReset.used = false;
                kToReset.system_info = "Reset by Admin";
                saveDB();
            }
            return res.json({ success: true });

        case 'ban_key':
            const kToBan = db.keys.find(k => k.key === body.key);
            if (kToBan) {
                kToBan.banned = true;
                saveDB();
            }
            return res.json({ success: true });

        case 'validate_key':
            const vKey = db.keys.find(k => k.key === body.key);
            const hwid = body.hwid;
            if (!vKey) return res.json({ success: false, message: "License key not found!" });
            if (vKey.banned) return res.json({ success: false, message: "This key has been banned!" });
            if (new Date(vKey.expires_at) < new Date()) return res.json({ success: false, message: "License has expired!" });
            if (!hwid) return res.json({ success: false, message: "Missing hardware ID (HWID)!" });

            if (!vKey.hwids) vKey.hwids = [];
            if (!vKey.hwid || vKey.hwid === hwid || vKey.hwids.includes(hwid)) {
                if (!vKey.hwids.includes(hwid)) {
                    const limit = vKey.device_limit || 1;
                    if (vKey.hwids.length >= limit) return res.json({ success: false, message: "Limit reached!" });
                    vKey.hwids.push(hwid);
                }
                vKey.hwid = hwid;
                vKey.used = true;
                vKey.system_info = body.system_info || "Android Device";
                saveDB();
                return res.json({ success: true, message: "Login successful!", expires_at: vKey.expires_at });
            } else {
                return res.json({ success: false, message: "Wrong HWID!" });
            }

        case 'get_supports':
            return res.json({ 
                success: true, 
                supports: db.supports.map(id => ({ user_id: id, added_by: 'Admin', added_at: new Date() })) 
            });

        // --- THÊM: ADD/DELETE SUPPORT (Cho tab Quản lý Support) ---
        case 'add_support':
            if (!db.supports.includes(body.user_id)) {
                db.supports.push(body.user_id);
                saveDB();
            }
            return res.json({ success: true });

        case 'delete_support':
            db.supports = db.supports.filter(id => id !== body.user_id);
            saveDB();
            return res.json({ success: true });

        default:
            return res.json({ success: false, message: "Invalid action!" });
    }
});

app.get('/', (req, res) => {
    res.send('🚀 API IS RUNNING OK | PHAT DEV COPPYRIGHT');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVER FULL TÍNH NĂNG - PORT ${PORT}`);
});
