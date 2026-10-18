import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import fs from "node:fs";
import http from "node:http";

const DATA_FILE = new URL("./data.json", import.meta.url);

function loadData() {
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
  } catch {
    return { assignments: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function daysUntil(dateString) {
  const due = new Date(dateString + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due - today) / 86400000);
}

function buildServer() {
  const server = new McpServer({
    name: "campuspilot",
    version: "1.0.0",
  });

  server.registerTool(
    "add_assignment",
    {
      description: "Adds an assignment or exam to the student's task list",
      inputSchema: {
        title: z.string().describe("Name of the assignment or exam"),
        subject: z.string().describe("Subject, e.g. Maths"),
        dueDate: z.string().describe("Due date in YYYY-MM-DD format"),
        hoursNeeded: z.number().describe("Estimated hours of work needed"),
      },
    },
    async ({ title, subject, dueDate, hoursNeeded }) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || isNaN(new Date(dueDate))) {
        return {
          isError: true,
          content: [
            { type: "text", text: "Invalid date. Please use YYYY-MM-DD, like 2026-10-22." },
          ],
        };
      }
      if (hoursNeeded <= 0) {
        return {
          isError: true,
          content: [{ type: "text", text: "hoursNeeded must be more than 0." }],
        };
      }

      const data = loadData();
      const assignment = {
        id: data.assignments.length + 1,
        title,
        subject,
        dueDate,
        hoursNeeded,
        done: false,
      };
      data.assignments.push(assignment);
      saveData(data);

      return {
        content: [
          {
            type: "text",
            text: `Added "${title}" (${subject}), due ${dueDate}, about ${hoursNeeded}h. It is task #${assignment.id}.`,
          },
        ],
      };
    }
  );

  server.registerTool(
    "list_assignments",
    {
      description: "Lists all assignments sorted by due date, with days remaining",
    },
    async () => {
      const data = loadData();
      if (data.assignments.length === 0) {
        return { content: [{ type: "text", text: "No assignments yet." }] };
      }

      const lines = [...data.assignments]
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
        .map((a) => {
          const days = daysUntil(a.dueDate);
          const when = days < 0 ? "OVERDUE" : `${days} day(s) left`;
          return `#${a.id} ${a.title} (${a.subject}) - due ${a.dueDate} - ${when} - ${a.hoursNeeded}h`;
        });

      return { content: [{ type: "text", text: lines.join("\n") }] };
    }
  );

  server.registerTool(
    "create_study_plan",
    {
      description:
        "Creates a day-by-day study plan that spreads each assignment's hours over the days left before its deadline",
      inputSchema: {
        hoursPerDay: z.number().describe("Hours the student can study per day"),
      },
    },
    async ({ hoursPerDay }) => {
      if (hoursPerDay <= 0) {
        return {
          isError: true,
          content: [{ type: "text", text: "hoursPerDay must be more than 0." }],
        };
      }

      const data = loadData();
      const pending = data.assignments
        .filter((a) => !a.done && daysUntil(a.dueDate) >= 0)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));

      if (pending.length === 0) {
        return { content: [{ type: "text", text: "No upcoming assignments to plan." }] };
      }

      const lastDay = daysUntil(pending[pending.length - 1].dueDate);
      const capacity = Array(lastDay + 1).fill(hoursPerDay);
      const plan = Array.from({ length: lastDay + 1 }, () => []);
      const warnings = [];

      for (const a of pending) {
        let left = a.hoursNeeded;
        const due = daysUntil(a.dueDate);
        // Fill the days just before the deadline first (latest-first).
        for (let d = Math.max(due - 1, 0); d >= 0 && left > 0; d--) {
          const give = Math.min(capacity[d], left);
          if (give > 0) {
            plan[d].push(`${give}h ${a.title}`);
            capacity[d] -= give;
            left -= give;
          }
        }
        if (left > 0) {
          warnings.push(`WARNING: "${a.title}" is short by ${left}h. Add more study hours or start earlier.`);
        }
      }

      const lines = plan
        .map((items, d) => {
          const date = new Date();
          date.setDate(date.getDate() + d);
          const label = date.toISOString().slice(0, 10);
          return items.length ? `Day ${d} (${label}): ${items.join(", ")}` : null;
        })
        .filter(Boolean);

      return {
        content: [{ type: "text", text: [...lines, ...warnings].join("\n") }],
      };
    }
  );

  server.registerTool(
    "generate_quiz",
    {
      description:
        "Creates fill-in-the-blank quiz questions, with an answer key, from the student's study notes",
      inputSchema: {
        notes: z.string().describe("Study notes with several full sentences"),
        numQuestions: z.number().describe("How many questions to create"),
      },
    },
    async ({ notes, numQuestions }) => {
      if (numQuestions < 1) {
        return {
          isError: true,
          content: [{ type: "text", text: "numQuestions must be at least 1." }],
        };
      }

      const sentences = notes
        .split(/(?<=[.!?])\s+/)
        .map((s) => s.trim())
        .filter((s) => s.split(/\s+/).length >= 5);

      if (sentences.length === 0) {
        return {
          isError: true,
          content: [
            { type: "text", text: "Please give notes with at least one full sentence (5+ words)." },
          ],
        };
      }

      const chosen = sentences.slice(0, Math.min(numQuestions, sentences.length));
      const questions = [];
      const answers = [];

      chosen.forEach((sentence, i) => {
        const words = sentence.split(/\s+/);
        const clean = (w) => w.replace(/[^A-Za-z0-9]/g, "");
        let best = 0;
        words.forEach((w, idx) => {
          if (clean(w).length > clean(words[best]).length) best = idx;
        });
        const answer = clean(words[best]);
        const blanked = [...words];
        blanked[best] = words[best].replace(/[A-Za-z0-9]+/, "_____");
        questions.push(`Q${i + 1}. ${blanked.join(" ")}`);
        answers.push(`Q${i + 1}: ${answer}`);
      });

      const note =
        chosen.length < numQuestions
          ? `\n\n(Only ${chosen.length} question(s) could be made from these notes.)`
          : "";

      return {
        content: [
          {
            type: "text",
            text: `${questions.join("\n")}\n\nANSWER KEY\n${answers.join("\n")}${note}`,
          },
        ],
      };
    }
  );

  return server;
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : undefined;
}

function sendJsonError(res, status, message) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message }, id: null })
  );
}

if (process.argv.includes("--http")) {
  // Web mode: Streamable HTTP at http://127.0.0.1:3000/mcp
  const PORT = Number(process.env.PORT) || 3000;

  const httpServer = http.createServer(async (req, res) => {
    if (req.url !== "/mcp") {
      sendJsonError(res, 404, "Not found. Use /mcp");
      return;
    }
    if (req.method !== "POST") {
      sendJsonError(res, 405, "Method not allowed. Use POST.");
      return;
    }
    try {
      const body = await readBody(req);
      const server = buildServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: a fresh server per request
      });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      console.error("Request error:", err);
      sendJsonError(res, 500, "Internal server error");
    }
  });

  httpServer.listen(PORT, "127.0.0.1", () => {
    console.error(`CampusPilot MCP listening on http://127.0.0.1:${PORT}/mcp`);
  });
} else {
  // Default: stdio mode (used by the Inspector command)
  const server = buildServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}