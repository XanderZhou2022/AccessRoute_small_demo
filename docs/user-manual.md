# AccessRoute HK user manual

This guide is for someone who does not work in IT. It explains how to start and use the AccessRoute demo after receiving a ZIP file.

## Before you start

You need:

- A Windows or Mac computer with an internet connection for the first setup.
- A modern browser. Google Chrome or Microsoft Edge is recommended for voice input.
- Node.js 22 LTS or newer. Download it from [nodejs.org](https://nodejs.org/).

You only need to install Node.js once. Keep the default installation options, then restart the computer if the installer asks.

## First-time setup

1. Find the downloaded ZIP file.
2. Extract it:
   - **Windows:** right-click the ZIP file, then choose **Extract All**.
   - **Mac:** double-click the ZIP file.
3. Open the extracted `AccessRoute_small_demo-main` folder.
4. Open a terminal in that folder:
   - **Windows:** right-click an empty area in the folder and choose **Open in Terminal**.
   - **Mac:** open **Terminal**, type `cd ` including the space, then drag the extracted folder into the Terminal window and press Return.
5. Copy and run this one command:

   ```bash
   npm install && npm run dev
   ```

   The first start can take a few minutes because it downloads the required components. Keep the terminal window open while using the demo.

6. When the terminal displays `Local: http://127.0.0.1:5173/`, open this address in your browser:

   ```text
   http://127.0.0.1:5173/map-demo/index.html
   ```

## Later starts

Open a terminal in the extracted folder and run:

```bash
npm run dev
```

Then open:

```text
http://127.0.0.1:5173/map-demo/index.html
```

If the browser says it cannot connect, wait about 10 seconds and refresh the page.

## Optional: enable Qwen AI

The route demo works without Qwen. Qwen is only needed for AI analysis of typed or spoken travel needs, photo-based obstacle reporting, location help, and AI guidance.

1. In the project folder, create a file named `.env`.
2. Copy the contents of `.env.example` into it.
3. Set your private Qwen/DashScope key on this line:

   ```env
   DASHSCOPE_API_KEY=your_private_key
   ```

4. Stop the demo, then run `npm run dev` again.

Never put the key in a browser field, an email, or a chat message. The `.env` file stays on the local computer.

To check that Qwen is enabled, open this address:

```text
http://127.0.0.1:8787/api/genai/capabilities
```

You should see `"configured": true`.

## Using the demo

1. Choose an accessibility profile, such as wheelchair, stroller, elderly, heavy luggage, or walking.
2. Select the origin and destination.
3. Choose route preferences, such as sheltered routing, avoiding stairs, elevators, or steep slopes.
4. Optional: describe needs in the text box and select **Use Qwen to analyse needs**.
5. Select **Search route**.
6. Compare route choices and start navigation.
7. On a **floor navigation** map:
   - use the floor buttons to switch floors;
   - use the `+` and `−` controls at the upper-right of the map to zoom in or out.
8. Use the help/report controls to report a facility issue or request location assistance.

## Voice input

Voice input requires Google Chrome or Microsoft Edge and microphone permission.

When the browser asks for microphone access, select **Allow**. If it was previously blocked:

- **Chrome / Edge:** select the lock or site-settings icon beside the website address, then set **Microphone** to **Allow**.
- **Mac:** open **System Settings → Privacy & Security → Microphone**, then enable your browser.
- **Windows:** open **Settings → Privacy & security → Microphone**, then allow microphone access for the browser.

If voice input says `network`, the browser could not reach its speech-recognition service. Check the internet connection, disable a blocking VPN/proxy if appropriate, or type the request into the text box instead. Typed requests can still be analysed by Qwen.

## Stopping the demo

Return to the terminal window and press:

```text
Ctrl + C
```

The website will no longer be available after the server stops.

## Common problems

### “npm is not recognized” or “command not found: npm”

Node.js is not installed correctly. Install Node.js 22 LTS from [nodejs.org](https://nodejs.org/), close the terminal, open it again, and repeat the setup command.

### “Port 5173 is already in use”

Another copy of the demo is already running. First try opening:

```text
http://127.0.0.1:5173/map-demo/index.html
```

If it opens, use that copy instead of starting another one. Otherwise, close any other Terminal/PowerShell windows running AccessRoute and run `npm run dev` once.

### “Qwen analysis failed”

Check that `.env` contains a valid `DASHSCOPE_API_KEY`, then stop and restart the demo. The route planner continues to work without Qwen.

### The map or controls look old

Refresh the browser:

- **Windows:** `Ctrl + R`
- **Mac:** `Command + R`

## Safety note

This is a demonstration tool, not certified real-world accessibility navigation. Confirm route conditions, station facilities, lift availability, and safety information before travelling.
