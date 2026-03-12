# GIF Feature Setup

The GIF picker uses the [Giphy API](https://developers.giphy.com/) for SFW GIF search.

## Get a Free API Key

1. Go to [https://developers.giphy.com/](https://developers.giphy.com/)
2. Click **Get Started** and create a free account (no credit card required)
3. Create a new app — select the **API** option
4. Copy your API key

## Configure the Key

Open `src/renderer/managers/gif-picker.ts` and replace the placeholder:

```ts
const GIPHY_API_KEY = "GIPHY_API_KEY_PLACEHOLDER";
```

With your key:

```ts
const GIPHY_API_KEY = "your_actual_key_here";
```

Then rebuild:

```bash
npm run build
```

## Free Tier Limits

| Limit | Value |
|-------|-------|
| Requests/hour | 42 |
| Requests/day | 4,200 |
| Content rating | `g` (SFW enforced) |

The free tier is more than sufficient for a private chat client.
