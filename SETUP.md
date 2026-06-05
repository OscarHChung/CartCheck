# CartCheck Setup

A Snap Spectacles lens that scans products and compares in-store prices vs Amazon.

## Requirements
- Lens Studio 5.15.4 or later
- Spectacles hardware (for production use) or emulator (for testing)
- API keys for OpenAI, SerpApi, and Anthropic Claude

## API Keys Required

You need three keys to use this lens:

| Service | Where to Get | Cost |
|---------|--------------|------|
| OpenAI | https://platform.openai.com/api-keys | ~$0.002 per scan, $5 min deposit | Vision for determining the product
| SerpApi | https://serpapi.com/users/sign_up | Free for 100 scans/month | Accurate real-time cost lookup for determinning price of product
| Claude | https://console.anthropic.com/settings/keys | ~$0.001 per scan, free starter credits | Verdict judge and advice generation

Total cost per scan: about $0.003

## Setup Steps

1. Clone or download this repo
2. Open `CartCheck.esproj` in Lens Studio
3. In the Scene Hierarchy, select **Orthographic Camera**
4. In the Inspector, find the **CartCheck** script component
5. Paste your API keys into:
   - **Openai Key**
   - **Serpapi Key**
   - **Claude Key**
6. Save (Ctrl+S)
7. Reset preview to test

## How to Use

- **Tap** (in emulator) or **pinch** (on Spectacles) to scan a product
- The HUD shows in-store price, Amazon price, and a verdict
- Tap/pinch again to dismiss the HUD or trigger a new scan

## Border Color Legend
- **Red** — Amazon is 20%+ cheaper, skip it
- **Yellow** — Amazon is slightly cheaper or same price
- **Green** — Store is cheaper than Amazon
- **Blue** — Amazon price found but no shelf tag visible
- **Gray** — No price comparison available
