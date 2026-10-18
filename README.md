# CampusPilot MCP

An MCP (Model Context Protocol) server that helps students plan their studies. Built for the Build, Ship, Shape: Amazon Developer Hackathon, Alexa+ track.

## Tools

- `add_assignment`: saves an assignment or exam with a due date and hours needed
- `list_assignments`: lists tasks sorted by due date with days remaining
- `create_study_plan`: spreads study hours across the days before each deadline and warns if time is short
- `generate_quiz`: turns study notes into fill-in-the-blank questions with an answer key

## Setup

Requires Node.js 18 or newer.

```
git clone https://github.com/01fe25bec314-coder/campuspilot-mcp.git
cd campuspilot-mcp
npm install
```

## Run and test

**Option 1: stdio mode with the MCP Inspector**

```
npx @modelcontextprotocol/inspector node server.js
```

Open the address printed in the terminal, connect to the server, and try the tools from the Tools tab.

**Option 2: web server (Streamable HTTP)**

```
node server.js --http
```

The MCP endpoint is `http://127.0.0.1:3000/mcp` (MCP spec 2025-11-25). To test it, run `npx @modelcontextprotocol/inspector` in a second terminal, then add a Streamable HTTP server with that URL.

## Data

Assignments are saved in `data.json`, which is created automatically.

## License

MIT