# Verifin — Django Backend Specification

## Overview
This document describes the full backend architecture for **Verifin**, a SaaS business operating system for African SMEs. The Django backend should provide REST APIs (Django REST Framework) for all frontend tabs and features.

---

## Apps & Models

### 1. `accounts`
- **User** (extend AbstractUser): email, phone, business_name, currency, currency_symbol, dark_mode, onboarding_complete
-each user should have a profile,and profile should have everything that describes a user but ins't required for them to log in.
- **Staff**: user (FK), name, role (Owner/Cashier/Stock Manager/Manager), status (Active/Inactive), last_active
- Endpoints: register, login, logout, profile CRUD, staff CRUD, role-based permissions
- **Google OAuth**: Support Sign in with Google via `django-allauth` or `dj-rest-auth` with social login adapter

### 2. `inventory`
- **Product**: name, sku, barcode, category (FK), stock, reorder_level, price, status (ok/low/out), created_at, updated_at
- **Category**: name, user (FK)
- **StockMovement**: product (FK), quantity, movement_type (in/out/adjustment), reason, created_by, created_at
- Endpoints: product CRUD, category CRUD, stock adjustment, barcode lookup, bulk import
- **Barcode Scanning**: GET /inventory/barcode-lookup/?code=<barcode> — returns product by barcode

### 3. `sales`
- **Sale**: items (text), total, payment_method (Cash/EFT/Card), customer (FK nullable), created_by, date, time
- **SaleItem**: sale (FK), product (FK), quantity, unit_price, subtotal
- Endpoints: sale CRUD, daily/weekly/monthly aggregations, sales by product/customer
- Auto-update customer visits, totalSpent, and loyaltyPoints on sale creation

### 4. `expenses`
- **Expense**: description, amount, category, date, created_by, receipt_image (optional)
- **ExpenseCategory**: name (Transport/Utilities/Stock Purchase/Communication/Rent/Salary/Other)
- Endpoints: expense CRUD, category breakdown, OCR receipt upload endpoint

### 5. `audits`
- **Audit**: date, status (in_progress/completed), items_counted, discrepancies_found, conductor (FK to Staff/User), completed_at
- **Discrepancy**: audit (FK), product (FK), expected_stock, actual_stock, difference, status (unresolved/investigating/resolved), resolved_by, resolved_at
- **StockCount**: audit (FK), product (FK), counted_quantity, counted_by
- Endpoints: audit CRUD, start/complete audit, submit stock counts, resolve discrepancy
- Close/complete audit: POST /audits/<id>/complete/ — calculates discrepancies and updates status

### 6. `customers`
- **Customer**: name, phone, total_spent, visits, loyalty_points, qr_code (unique), credits, last_visit, badge (bronze/silver/gold/platinum), created_at
- **LoyaltyTransaction**: customer (FK), points_change, reason, created_at
- **CreditTransaction**: customer (FK), amount, type (add/redeem), reason, created_at
- Endpoints: customer CRUD, QR code generation, add credit, redeem credit, loyalty point calculation, visit tracking, badge management
- **QR Loyalty System**: Each customer gets a unique QR code encoding their ID. Scanning at checkout tracks visits and applies credits.
- **Badge System**: Customers are assigned badges (Bronze, Silver, Gold, Platinum) manually or automatically based on business relationship. Badges are selectable when adding/editing customers.
- POST /customers/<id>/add-credit/ — adds credit to customer balance
- POST /customers/<id>/redeem-credit/ — deducts credit at checkout

### 7. `reports`
- No models — aggregation views over sales, expenses, inventory, audits, customers
- Endpoints:
  - GET /reports/daily-sales/
  - GET /reports/weekly-performance/
  - GET /reports/stock-movement/
  - GET /reports/discrepancy/
  - GET /reports/customer/
  - GET /reports/expense-analysis/
  - GET /reports/profit-loss/
  - GET /reports/monthly-overview/
  - GET /reports/export/?type=csv|pdf

### 8. `notifications`
- **NotificationPreference**: user (FK), whatsapp_daily, low_stock_alerts, discrepancy_alerts, push_enabled
- **NotificationLog**: user (FK), type, message, sent_at, channel (whatsapp/email/push)
- Endpoints: preference CRUD, send test notification, GET /notifications/ — list active notifications
- **Push Notifications**: Low stock alerts (generated when product stock <= reorder_level), daily sales summary push
- Background tasks (Celery): daily WhatsApp summary, low stock alerts, discrepancy alerts, push notification dispatch

### 9. `assistant`
- **AssistantLog**: user (FK), input_text, parsed_action, result, created_at
- Endpoint: POST /assistant/command/ — accepts natural language, returns structured action result
- NLP parsing for: sale recording, expense logging, stock restocking, queries (today's sales, low stock)
- Supported commands:
  - "Sold 3 loaves for R90" → creates sale
  - "Spent R200 on transport" → creates expense
  - "Restock 24 Coca-Cola" → updates product stock
  - "How are sales today?" → returns daily summary

### 10. `billing`
- **Subscription**: user (FK), plan (Starter/Growth/Business), status (active/trial/cancelled), trial_end, current_period_end
- **Payment**: subscription (FK), amount, currency, status, stripe_payment_id, created_at
- Endpoints: subscription CRUD, Stripe webhook handler, plan upgrade/downgrade

---

## Authentication
- JWT tokens (djangorestframework-simplejwt)
- Google OAuth via `django-allauth` + `dj-rest-auth` social login
- Role-based permissions: Owner (full access), Manager (most access), Cashier (sales/inventory only), Stock Manager (inventory/audits only)
- Build a Robust Athentication system, that is safe and secure

## Database
- SQLLite
- All models include created_at, updated_at timestamps
- Soft delete where appropriate (is_deleted flag)
- Save user data

## Background Tasks (Celery + Redis)
- Daily sales summary generation
- WhatsApp notification dispatch (via WhatsApp Business API)
- Low stock monitoring (hourly)
- Discrepancy alert processing
- Push notification dispatch (Firebase Cloud Messaging or similar)

## File Storage
- Receipt images: S3/MinIO
- QR code generation: server-side using `qrcode` library
- Report PDF generation: `reportlab` or `weasyprint`

## API Design
- RESTful with DRF ViewSets and Routers
- Pagination: cursor-based for lists
- Filtering: django-filter for all list endpoints
- Search: full-text search on products, customers
- Versioning: URL-based (/api/v1/)

## Offline Sync
- POST /sync/push/ — accepts array of offline actions with local timestamps
- GET /sync/pull/?since=<timestamp> — returns all changes since timestamp
- Conflict resolution: server wins, with conflict log
- Frontend queues actions in localStorage when offline, syncs on reconnection

## Settings
- Currency configuration per user
- Business profile
- Notification preferences (including push notification toggle)
- Dark mode preference (stored server-side)

## Frontend Features (for reference)
- **Login/Signup**: Email + password, Google OAuth, with password visibility toggle
- **Onboarding**: 4-step wizard (business name, currency, categories, initial stock) with skip warning dialog
- **Dashboard**: Auto Admin Assistant (NLP command bar with 10+ commands including inventory value, profit, top sellers, customer count), welcome back message with username, metrics, charts, quick actions, AI insights, live activity, real-time clock display
- **Inventory**: Product CRUD with auto-generated SKU, optional barcode with helper note, 15 product categories, barcode scanning via device camera (html5-qrcode), stock status indicators, added date + restock date tracking, search across name/SKU/barcode
- **Sales**: Sale recording with product-based line items (select product + quantity), automatic inventory deduction on sale, payment methods, customer linking, stock validation (prevents overselling), real-time search
- **Expenses**: Expense tracking with categories, real-time search
- **Audits**: Start/complete audits, manual stock counting, background automated audit engine with progress bar, auto-detection of low/out-of-stock items, discrepancy detection and resolution, search & status filter on audit history, view detailed auto-findings for completed audits
- **Reports**: 8 report types with charts (recharts), CSV/Excel export (UTF-8 BOM for Excel compatibility), WhatsApp daily summary sharing
- **Customers**: QR loyalty system (qrcode.react), badge system (Bronze/Silver/Gold/Platinum) with icon indicators, badge selection in add/edit forms, clickable cards for editing, credit management with proper number formatting, visit tracking, real-time search
- **Staff**: Staff CRUD with roles (Owner/Cashier/Stock Manager/Manager), real-time search
- **Settings**: Business profile, currency dropdown (ZAR/USD/ZWL/KES/NGN/GHS/BWP/EUR/GBP), notification preferences, dark mode toggle
- **Notifications**: In-app notification center with clickable read/unread states, low stock alerts, daily sales summaries
- **Demo**: Interactive guided 7-step tour with live demos per step, removed green left-border styling
- **Pricing**: 3 plans with realistic feature lists matching actual platform capabilities, fake checkout flow
- **Terms & Conditions**: Beautified legal page with card-based layout, section icons, 18 sections covering subscriptions, data ownership, acceptable use, API usage, liability, indemnification, refunds, force majeure, dispute resolution, and governing law
- **Privacy Policy**: Beautified privacy page with card-based layout, section icons, covering data collection, usage, sharing, security (AES-256, TLS 1.3), POPIA compliance, cookies, and user rights
- **Contact Page**: Contact form with email/phone/office details, message submission
- **Help Center**: Searchable knowledge base with 8 categories (each with detailed article content), clickable articles with popup dialog explanations, FAQ accordion, support contact info, Help accessible from dashboard quick actions
- **Careers Page**: Company values with Lucide icons (no emojis), open positions with apply-by-email
- **API Documentation**: RESTful API reference with endpoints, webhook events, authentication, rate limiting (Business plan)
- **Login/Signup**: Animated background with floating orbs, back-to-landing button, Google OAuth, email/password auth
- **Landing Page**: Hero with floating particles, Stats section, Features, How It Works, Trust & Reliability section, Testimonials, CTA, Footer with deduplicated links (no duplicate Contact), all emojis replaced with text
- **WhatsApp Sharing**: Dashboard button generates formatted daily summary and opens WhatsApp Web with pre-filled message
- **PWA Support**: Web manifest for installability (Add to Home Screen on iOS/Android), mobile-optimized meta tags
- **Offline Mode**: localStorage-based action queue (offlineQueue.ts) for recording sales/stock when offline, auto-sync on reconnection
- **Dark Mode**: System-wide dark/light toggle persisted in profile, applied via CSS class on document root
- **Scroll Behavior**: ScrollToTop component ensures all page navigations start at top
- **User Avatar**: Navbar avatar shows profile initials and navigates to Settings when clicked
- **Time Display**: Real-time clock in navbar header (hidden on mobile)
- **Auto Admin Assistant Commands**: sell, expense, restock, inventory value, today's sales, top sellers, total expenses, customer count, low stock, profit/loss, product count

## Deployment
- Docker + docker-compose
- Gunicorn + Nginx
- PostgreSQL + Redis
- Celery workers
- Environment variables for secrets
- CORS configuration for frontend domain
