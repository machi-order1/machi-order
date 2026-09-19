# V68 REMINDER MANAGER
- reminder-api v1 deployed live with JWT and manager membership enforcement.
- Manager can GET, create and edit store reminder rules.
- Enable/disable and edits are change-logged with before/after JSON.
- Added weekdays, active-shift requirement, repeat interval/max repeats, and version fields.
- Added push subscription schema foundation; actual Web Push delivery remains disabled until keys/permission/device tests.
- reminder-settings.html now talks to the real authenticated API rather than being a static mock.
- Production Netlify remains unchanged.
