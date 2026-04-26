---
name: browser-screenshot
description: "Browser screenshot patterns, used when taking screenshots or streaming."
---

# Browser Screenshot Skill

## Approaches

### A. html2canvas (JS Re-render)
- **How**: Re-draws DOM into `<canvas>` via JS — NOT a real screenshot
- **Pros**: No permission needed, programmable
- **Cons**: CSS gaps (backdrop-filter, shadows, fonts), captures full scrollable area unless manually cropped
- **Use when**: you need a quick, rough capture without user interaction

### B. getDisplayMedia (Native Capture) ★ Recommended
- **How**: `navigator.mediaDevices.getDisplayMedia()` — OS-level pixel-perfect capture
- **Pros**: Exact visual fidelity, any resolution
- **Cons**: Requires user permission click each time

### C. Persisted Low-Power Pattern ★ Best
```js
// First time: request & persist
const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
const video = document.createElement('video');
video.srcObject = stream;
await video.play();

window.__screenshotStream = stream;
window.__screenshotVideo = video;

// Sleep (minimal resources)
video.pause();
stream.getVideoTracks()[0].enabled = false;

// Wake → capture → sleep (no permission dialog!)
async function snap() {
  const track = window.__screenshotStream.getVideoTracks()[0];
  track.enabled = true;
  await window.__screenshotVideo.play();
  await new Promise(r => setTimeout(r, 150));

  const canvas = document.createElement('canvas');
  canvas.width = window.__screenshotVideo.videoWidth;
  canvas.height = window.__screenshotVideo.videoHeight;
  canvas.getContext('2d').drawImage(window.__screenshotVideo, 0, 0);

  window.__screenshotVideo.pause();
  track.enabled = false;

  // Trigger download
  const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `shot_${Date.now()}.png`;
  a.click(); a.remove();
  URL.revokeObjectURL(url);
}
```
