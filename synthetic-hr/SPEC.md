# Synthetic HR™ Webapp Specification

## Project Overview

- **Project Name**: Synthetic HR™ by Rasi Solutions
- **Type**: B2B Enterprise Web Application (Marketing Site + Interactive Dashboard)
- **Core Functionality**: A high-end corporate platform translating complex AI governance into familiar HR concepts, featuring an interactive Rasi-OS dashboard preview
- **Target Users**: CTOs, CIOs, Heads of AI, HR Directors, Enterprise Risk/Compliance Officers

---

## UI/UX Specification

### Layout Structure

**Navigation**
- Sticky top bar with logo, nav links (Pillars, Governance, Dashboard, Pricing), and CTA button
- Mobile hamburger menu

**Page Sections**
1. Hero Section - Split screen with value prop and abstract AI visualization
2. Core Philosophy - HR parallel framework diagram
3. The 4 Pillars - Interactive grid cards
4. Governance Layer - Technical specs accordion
5. Rasi-OS Dashboard - Interactive simulator (the "wow" feature)
6. Commercial Model - 3 pricing tier cards
7. Vision & Footer - Company vision and contact

**Responsive Breakpoints**
- Mobile: <768px (stacked, simplified)
- Tablet: 768px-1024px (2-column)
- Desktop: >1024px (full interactive)

### Visual Design

**Color Palette**
- Primary Background: #0F172A (Deep Slate Blue)
- Secondary Background: #1E293B (Slate 800)
- Primary Accent: #3B82F6 (Enterprise Blue)
- Highlight/Cyan: #06B6D4 (Cyan)
- Alert/Red: #EF4444 (Red)
- Warning/Yellow: #F59E0B (Amber)
- Success/Green: #10B981 (Emerald)
- Text Primary: #F8FAFC (Off-white)
- Text Secondary: #94A3B8 (Slate 400)
- Border: #334155 (Slate 700)

**Typography**
- Headings: Inter (Google Font) - weights 600, 700
- Body: Inter - weight 400, 500
- Code/Data: JetBrains Mono (Google Font)
- H1: 48px/56px, H2: 36px/44px, H3: 24px/32px, Body: 16px/24px

**Visual Effects**
- Glassmorphism on dashboard panels (backdrop-filter: blur(12px))
- Subtle grid background pattern
- Glow effects on active AI agent nodes
- Smooth hover transitions (0.3s ease)
- Gradient accents on CTAs

### Components

**1. Navigation**
- Logo (text-based "RASI" with "Synthetic HR")
- Nav links with hover underline animation
- "Book Audit" CTA button (primary blue)
- Mobile: Slide-out drawer menu

**2. Hero Section**
- Large headline with gradient text accent
- Tagline subtext
- Animated abstract AI network visualization (CSS)
- Primary CTA button

**3. Philosophy Section**
- Side-by-side comparison: "Traditional AI" vs "Synthetic HR Approach"
- Animated parallel list (AI Need → HR Solution)
- Visual diagram of HR-to-AI mapping

**4. Pillar Cards**
- 4 cards in grid (2x2 on tablet, 4x1 on desktop)
- Icon, title, description
- Hover: expand to show deliverables list
- Color-coded borders (blue, cyan, green, red)

**5. Governance Layer**
- Accordion-style expandable sections
- Technical specs with icons
- Safe Harbor SLA, Universal Connector, Async Auditing, Black Box

**6. Rasi-OS Dashboard (Interactive)**
- Tab navigation: Org Chart | Risk Score | Logs | Settings
- **Org Chart Tab**: Interactive node graph showing AI agents
  - Nodes: Support Bot, Sales Bot, Refund Bot, etc.
  - Click to see agent details
  - Risk level indicators (green/yellow/red)
- **Risk Score Tab**: Radial gauge chart (0-100)
  - Categories: Security, Financial, Brand, Legal, Cost
- **Logs Tab**: Scrolling log simulation
- **Kill Switch Demo**: Toggle to demonstrate termination protocol

**7. Pricing Cards**
- 3 cards: Audit (₹25k), Retainer (₹40k-60k/mo), Enterprise (Custom)
- Feature lists with checkmarks
- Recommended badge on Retainer
- CTA buttons

**8. Vision Section**
- Large quote with company vision
- "The CrowdStrike of AI Workforce Governance"
- Footer with links

---

## Functionality Specification

### Core Features

1. **Smooth Scroll Navigation** - Click nav links to scroll to sections
2. **Interactive Pillar Cards** - Hover/click to reveal detailed deliverables
3. **Dashboard Simulator**
   - Tab switching between views
   - Click AI agent nodes for details modal
   - Toggle Kill Switch with visual feedback
   - Risk score gauge animation
   - Live log simulation (scrolling text)
4. **Pricing Toggle** - (Optional) Monthly/Annual view
5. **Contact Form** - Simple inquiry form (frontend only)

### User Interactions

- Hover effects on all interactive elements
- Click to expand/collapse accordion sections
- Tab navigation in dashboard
- Modal popup for agent details
- Smooth scroll to sections

### Data Handling

- All data is mock/static (frontend only)
- No backend required
- Form submissions logged to console (demo)

---

## Acceptance Criteria

1. ✅ All 7 main sections rendered correctly
2. ✅ 4 Pillar cards with hover interactions
3. ✅ Interactive Rasi-OS Dashboard with tabs
4. ✅ Kill Switch toggle functional (visual only)
5. ✅ Risk Score gauge displays correctly
6. ✅ AI Org Chart with clickable nodes
7. ✅ 3 Pricing tiers displayed
8. ✅ Responsive on mobile/tablet/desktop
9. ✅ Dark theme consistent throughout
10. ✅ All animations smooth (60fps)
11. ✅ No console errors
12. ✅ Page loads under 3 seconds
