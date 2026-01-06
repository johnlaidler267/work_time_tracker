# Work Time Tracker

A simple and elegant time tracking application built with React and TypeScript.

## Features

- Add time in 10-minute or 25-minute increments
- View total time in hours and minutes
- Reset functionality
- Clean, modern UI with Tailwind CSS

## Development

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn

### Installation

```bash
npm install
```

### Run Development Server

```bash
npm run dev
```

The app will be available at `http://localhost:5173`

### Build for Production

```bash
npm run build
```

### Preview Production Build

```bash
npm run preview
```

## Deployment to GitHub Pages

### Initial Setup

1. Create a new repository on GitHub (e.g., `work_time_tracker`)
2. Update the `base` path in `vite.config.ts` to match your repository name:
   ```ts
   base: '/your-repo-name/',
   ```

### Deploy

```bash
npm run deploy
```

This will:
1. Build the production version
2. Deploy it to the `gh-pages` branch
3. Make it available at `https://yourusername.github.io/your-repo-name/`

### Enable GitHub Pages

1. Go to your repository settings on GitHub
2. Navigate to "Pages" in the left sidebar
3. Under "Source", select the `gh-pages` branch
4. Click "Save"

Your site will be live at the URL shown in the Pages settings!

## Technologies

- React 18
- TypeScript
- Vite
- Tailwind CSS

