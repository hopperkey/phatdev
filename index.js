const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// 🔑 SUPABASE INIT
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

app.post('/auth', async (req, res) => {
  const body = req.body;
  const action = body.action;
  const userId = body.user_id || body.userId || 'Guest';

  try {
    switch (action) {
      case 'test':
        return res.json({ success: true });

      // ===== APPS =====
      case 'get_apps': {
        const { data, error } = await supabase
          .from('applications')
          .select('*');
        if (error) throw error;
        return res.json({ success: true, applications: data });
      }

      case 'create_app': {
        const { error } = await supabase.from('applications').insert({
          name: body.app_name,
          api_key: 'AK-' + Math.random().toString(36).substring(2, 12).toUpperCase(),
          created_by: userId,
          created_at: new Date().toISOString()
        });
        if (error) throw error;
        return res.json({ success: true });
      }

      case 'delete_app': {
        await supabase.from('applications').delete().eq('name', body.app_name);
        await supabase.from('keys').delete().eq('api', body.api);
        return res.json({ success: true });
      }

      // ===== KEYS =====
      case 'get_keys': {
        const query = supabase.from('keys').select('*');
        const { data, error } = body.api
          ? await query.eq('api', body.api)
          : await query;
        if (error) throw error;
        return res.json({ success: true, keys: data });
      }

      case 'create_key': {
        const newKey = {
          key: (body.prefix || 'VIP') + '-' + Math.random().toString(36).substring(2, 10).toUpperCase(),
          api: body.api,
          prefix: body.prefix || 'VIP',
          created_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + body.days * 86400000).toISOString(),
          device_limit: body.device_limit || 1,
          hwids: [],
          banned: false
        };
        const { error } = await supabase.from('keys').insert(newKey);
        if (error) throw error;
        return res.json({ success: true, key: newKey.key });
      }

      case 'delete_key':
        await supabase.from('keys').delete().eq('key', body.key);
        return res.json({ success: true });

      case 'ban_key':
        await supabase.from('keys').update({ banned: true }).eq('key', body.key);
        return res.json({ success: true });

      case 'reset_hwid':
        await supabase
          .from('keys')
          .update({ hwids: [], system_info: 'Reset by Admin' })
          .eq('key', body.key);
        return res.json({ success: true });

      // ===== VALIDATE =====
      case 'validate_key': {
        const { data, error } = await supabase
          .from('keys')
          .select('*')
          .eq('key', body.key)
          .single();
        if (error || !data) return res.json({ success: false, message: 'Key not found' });
        if (data.banned) return res.json({ success: false, message: 'Key banned' });
        if (new Date(data.expires_at) < new Date())
          return res.json({ success: false, message: 'Key expired' });

        const hwid = body.hwid;
        if (!hwid) return res.json({ success: false, message: 'Missing HWID' });

        const hwids = data.hwids || [];
        if (!hwids.includes(hwid)) {
          if (hwids.length >= data.device_limit)
            return res.json({ success: false, message: 'Device limit reached' });
          hwids.push(hwid);
        }

        await supabase
          .from('keys')
          .update({ hwids, system_info: body.system_info || 'Android' })
          .eq('key', body.key);

        return res.json({ success: true, expires_at: data.expires_at });
      }

      default:
        return res.json({ success: false, message: 'Invalid action' });
    }
  } catch (err) {
    return res.json({ success: false, message: err.message });
  }
});

app.get('/', (req, res) => {
  res.send('🚀 API SUPABASE RUNNING OK');
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('🚀 SERVER RUNNING ON PORT ' + PORT);
});