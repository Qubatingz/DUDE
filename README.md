# Dude

<img src="app/icon.png" width="120" align="right" alt="Dude's face">

Dude is a desktop companion for Windows. He lives on your screen, walks along the bottom and on top of your open windows, talks, jokes, dances, finds your files, remembers what you worked on, and gets sick when your laptop has problems.

## Get Dude

1. Download **Dude-for-Windows.zip** from the [Releases](../../releases/latest) page.
2. Right-click the zip > **Extract All**. Open the **Dude** folder and double-click **Dude.exe**.
3. If Windows says "Windows protected your PC", click **More info** > **Run anyway**. Dude is new and not code-signed yet.
4. Open **START HERE.txt** in the same folder for the full guide.

## Play with him

- Grab him and throw him. He bounces off the screen edges.
- He walks on your windows. Drag a window while he stands on it.
- Right-click him, or press **Ctrl+Shift+D**, for his control panel.
- Hold **Ctrl+Shift+Space** to talk to him with your voice.
- His face sits in the tray near the clock: controls, Studio, jokes, voice, sleep, start with Windows, quit.
- **Ctrl+Shift+Q** quits him instantly.

## What he can do

- **Acting:** lip-synced talking, hand gestures that match his words, 20+ facial expressions, blinking, head movement, idle fidgets.
- **Rubber-hose body:** a bendy torso and noodle arms and legs. Try the **Noodle groove** dance.
- **A new outfit every day of the week:** hoodie Monday, tracksuit Tuesday, the original green beanie on Wednesday, and more.
- **19 moves:** noodle groove, moonwalk, backflip, head spin, robot, air guitar, banana slip, freestyle rap, graffiti...
- **AI brain (optional):** add your own Claude API key in the **Brain** tab and he really understands you. Without a key he still chats with simple built-in replies.
- **Finds your files:** "find the beat I made last week" searches only the folders you allowed.
- **Check-up report:** big files, old downloads, possible duplicates, piles of screenshots.
- **Memory:** "what was I working on yesterday?" and "remind me to call Eric in 30 minutes".
- **Knows when to be quiet:** fullscreen, Zoom, Teams, FL Studio, Ableton, or Do Not Disturb.
- **Voice:** pick a voice preset or any Windows voice, then tune pitch and speed.
- **Gets sick for real:** low battery, no internet, processor at 90%+, or a nearly full disk.

## Privacy

Dude asks before he touches anything. Access to your folders, apps and recent files is off until you turn it on in the **Access** tab, and if he needs a folder you haven't allowed, he asks first. He only reads file names, sizes and dates, never what is inside your files. He never moves or deletes anything. His memory stays on your laptop and **Forget everything** wipes it. Your API key is encrypted with Windows' own protection and only goes to Claude.

## Project layout

| Path | What it is |
| --- | --- |
| `web/dude.html` | The whole character: drawing, animation, face, personality, control panel. Also runs in a normal browser as a demo. |
| `app/main.js` | Windows app: transparent always-on-top window, tray menu, shortcuts, health stats, permissions. |
| `app/brain.js` | The AI brain: talks to Claude and gives it tools (search files, report, reminders, moves). |
| `app/files.js` | File search, the check-up report, and watching for new downloads and exports. |
| `app/memory.js` | What you worked on each day, kept on your laptop. |
| `app/settings.js` | Permissions, allowed folders, the encrypted API key. |
| `app/windows.ps1` | Reads where your open windows are so he can stand on them, and which app is in front so he can stay quiet. |
| `app/listen.ps1` | Push-to-talk speech recognition using Windows' built-in recognizer. |
| `build-windows.sh` | Builds `dist/Dude-for-Windows.zip` with Electron. |

Created by Kirenga Jimmy.
