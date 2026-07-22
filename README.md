# Railway Deployment

## Files
- `server.js`: Node.js entry file
- `index.html`: frontend page
- `realtime-addon.css`: realtime feature styles
- `realtime-addon.js`: frontend realtime logic and mobile reconnect logic
- `package.json`: npm dependencies and start script
- `.env.example`: local environment variable example

## Start Command

```bash
node server.js
```

Railway can also use the npm start script:

```bash
npm start
```

## Required Railway Variables

Set exactly these variables in Railway:

```text
PORT
AUTH_SECRET
COUPLE_A_USERNAME
COUPLE_A_PASSWORD
COUPLE_A_NAME
COUPLE_B_USERNAME
COUPLE_B_PASSWORD
COUPLE_B_NAME
```

## Deploy
1. Push this folder to GitHub.
2. Railway -> `New Project` -> `Deploy from GitHub repo`.
3. Select the repository.
4. Add the required variables above.
5. Deploy and open the public Railway URL on mobile.
