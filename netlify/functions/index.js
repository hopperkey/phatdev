const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const router = express.Router();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

app.use(cors());
app.use(bodyParser.json());

router.post('/auth', async (req, res) => {
    const body = req.body;
    const action = body.action;
    const userId = body.user_id || body.userId || "Guest";

    try {
        switch (action) {
            case 'test':
                return res.json({ success: true });

            case 'get_analytics': {
                const now = new Date().toISOString();
                const { data: keys } = await supabase.from('keys').select('*');
                const { count: totalApps } = await supabase.from('applications').select('*', { count: 'exact', head: true });
                
                return res.json({
                    success: true,
                    total_keys: keys?.length || 0,
                    active_keys: keys?.filter(k => k.hwid && !k.banned && k.expires_at > now).length || 0,
                    banned_keys: keys?.filter(k => k.banned).length || 0,
                    expired_keys: keys?.filter(k => k.expires_at < now).length || 0,
                    total_apps: totalApps || 0
                });
            }

            case 'get_users': {
                const { data: users } = await supabase.from('keys').select('*').not('hwid', 'is', null);
                const now = new Date();
                return res.json({ 
                    success: true, 
                    users: users.map(k => ({
                        user_id: k.hwid,
                        key_used: k.key,
                        system_info: k.system_info || "Android Device",
                        last_login: k.created_at,
                        status: k.banned ? "Banned" : (new Date(k.expires_at) < now ? "Expired" : "Active")
                    }))
                });
            }

            case 'check_support': {
                const { data: role } = await supabase.from('permissions').select('role').eq('user_id', userId).single();
                const isSupport = role?.role === 'admin' || role?.role === 'support';
                return res.json({ success: true, is_support: isSupport });
            }

            case 'check_permission': {
                const { data: role } = await supabase.from('permissions').select('role').eq('user_id', userId).single();
                const { count: appCount } = await supabase.from('applications').select('*', { count: 'exact', head: true });
                return res.json({ success: true, is_admin: role?.role === 'admin', app_count: appCount || 0 });
            }

            case 'get_apps': {
                const { data } = await supabase.from('applications').select('*');
                return res.json({ success: true, applications: data || [] });
            }

            case 'create_app': {
                await supabase.from('applications').insert([{
                    name: body.app_name,
                    api_key: "AK-" + Math.random().toString(36).substring(2, 12).toUpperCase(),
                    created_by: userId
                }]);
                return res.json({ success: true });
            }

            case 'get_keys': {
                let query = supabase.from('keys').select('*');
                if (body.api) query = query.eq('api', body.api);
                const { data: keys } = await query;
                const now = new Date();
                const processed = keys.map(k => ({
                    ...k,
                    status: k.banned ? "Banned" : (new Date(k.expires_at) < now ? "Expired" : (k.hwid ? "Active" : "Inactive"))
                }));
                return res.json({ success: true, keys: processed });
            }

            case 'create_key': {
                const newKey = {
                    key: (body.prefix || "VIP") + "-" + Math.random().toString(36).substring(2, 10).toUpperCase(),
                    api: body.api,
                    prefix: body.prefix || "VIP",
                    expires_at: new Date(Date.now() + (body.days * 86400000)).toISOString(),
                    device_limit: parseInt(body.device_limit) || 1
                };
                await supabase.from('keys').insert([newKey]);
                return res.json({ success: true, key: newKey.key });
            }

            case 'validate_key': {
                const { data: vKey } = await supabase.from('keys').select('*').eq('key', body.key).single();
                if (!vKey) return res.json({ success: false, message: "License key not found!" });
                if (vKey.banned) return res.json({ success: false, message: "This key has been banned!" });
                if (new Date(vKey.expires_at) < new Date()) return res.json({ success: false, message: "License has expired!" });

                const hwid = body.hwid;
                let hwids = vKey.hwids || [];
                if (hwids.includes(hwid)) {
                    return res.json({ success: true, message: "Login successful!", expires_at: vKey.expires_at });
                } else if (hwids.length < (vKey.device_limit || 1)) {
                    hwids.push(hwid);
                    await supabase.from('keys').update({ hwids, hwid, used: true, system_info: body.system_info || "Android Device" }).eq('key', body.key);
                    return res.json({ success: true, message: "Device registered!", expires_at: vKey.expires_at });
                }
                return res.json({ success: false, message: "Device limit reached!" });
            }

            case 'reset_hwid':
                await supabase.from('keys').update({ hwids: [], hwid: null, used: false, system_info: "Reset by Admin" }).eq('key', body.key);
                return res.json({ success: true });

            case 'ban_key':
                await supabase.from('keys').update({ banned: true }).eq('key', body.key);
                return res.json({ success: true });

            case 'add_support':
                await supabase.from('permissions').upsert([{ user_id: body.user_id, role: 'support' }]);
                return res.json({ success: true });

            case 'delete_support':
                await supabase.from('permissions').delete().eq('user_id', body.user_id);
                return res.json({ success: true });

            default:
                return res.json({ success: false, message: "Invalid action!" });
        }
    } catch (e) {
        return res.json({ success: false, message: e.message });
    }
});

app.use('/.netlify/functions/index', router);
module.exports.handler = serverless(app);
