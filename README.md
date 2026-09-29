# 📖 TBQ (Teen Bible Quiz) Platform

Complete ministry platform for Church Teen Bible Quiz coaches and parents:
1. **Public Practice Signups**: 1-on-1 15-minute prep session scheduler for parents and quizzers.
2. **Coach Match Scorekeeper**: Real-time round scoring, interruption tracking, official "Quiz Out" (5 correct answers) automation, and question audit feed.
3. **Teams & Quizzers Manager**: Add and manage team kids, opposite church teams, and match round counts.
4. **Super Coach Multi-Coach Administration**: Manage assistant coaches, create custom accounts, reset passcodes, and control permissions.

---

## 🌐 Live Web Links

- 🚀 **Render Live App**: 👉 **[https://tbq-jbq.onrender.com](https://tbq-jbq.onrender.com)**  
- 🌩️ **Cloudflare Tunnel (Local dev)**: 👉 **[https://dublin-hist-adding-foo.trycloudflare.com](https://dublin-hist-adding-foo.trycloudflare.com)**  
*(Open on any mobile phone, tablet, or laptop)*

---

## 🔑 Login Credentials

Tap **"🔒 Coach Login"** at the top right:

| Role | Username | Passcode | Permissions |
| :--- | :--- | :--- | :--- |
| **👑 Super Coach** | `supercoach` | `super2026` | **Full Authority**: Score matches, manage practice slots, add kids & opposite teams, **PLUS add, edit, and delete other coaches** |
| **👤 Regular Coach** | `coach` | `coach2026` | **Team Coach**: Score matches, manage practice slots, add/remove kids and opposite teams |
| **Public Visitor** | *(No login)* | *(None)* | **Signups Only**: Select time slot, pick quizzer name, confirm practice session |

---

## 👥 Managing Kids & Teams (For Any Coach)

Navigate to the **"👥 Teams & Quizzers"** tab:
- **Home Team Roster**:
  - Type a name (e.g. *Caleb*, *Grace*) and click **"+ Add Kid"**.
  - New kids immediately sync into:
    1. The practice signups student dropdown
    2. The live roster tracker badges
    3. The match scorekeeper buzzing buttons
  - Remove any kid who is no longer participating.
- **Opposite Team Configuration**:
  - Change Meet Title (e.g. *District Invitational*).
  - Set Opponent Church Name (e.g. *Faith Chapel*).
  - Add Opponent Quizzers (comma-separated list).
  - Adjust total number of rounds in the meet (e.g. 1 to 10 rounds).

---

## 🛡️ Managing Coaches (Super Coach Only)

Logged in as `supercoach`:
- Open the **"🛡️ Manage Coaches"** tab in the navigation bar.
- Click **"➕ Add New Coach"** to create a login for an assistant coach or church leader.
- Define their Name, Username, Passcode, and Role (`Coach` or `Super Coach`).
- Delete or reset passcodes for any coach at any time.

---

## 💻 Running Locally

To launch the server and Cloudflare tunnel on your Mac:
```bash
cd /Users/pandiyarajanjeyabalan/Desktop/coach
./start.sh
```
Press `Ctrl + C` in terminal to stop.
