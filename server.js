/* Local Express dev server — delegates to the same handlers Vercel uses (api/*.js).
   Run `vercel dev` for the production-equivalent serverless flow,
   or `node server.js` for plain Node. */

require("dotenv").config();
const express = require("express");
const path = require("path");

const analyzeHandler = require("./api/analyze");
const feedbackHandler = require("./api/feedback");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname)));
app.post("/api/analyze", (req, res) => analyzeHandler(req, res));
app.post("/api/feedback", express.json({ limit: "1mb" }), (req, res) => feedbackHandler(req, res));

app.listen(PORT, () => {
  console.log(`Hermes Concert Studio (Express dev) running at http://localhost:${PORT}`);
});
