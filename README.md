🚀 Ellstack Amigo AI Chatbot

Ellstack Amigo is a modern, scalable, full-stack framework that allows you to run an AI-powered WhatsApp chatbot locally — on any laptop or on-premise/private cloud server, without requiring a GPU and without paying API credits to OpenAI, Claude, WhatsApp Cloud API, or any other provider.

With a simple Next → Next → Finish installation, you can:

Connect your WhatsApp via QR code

Run Llama 3.2 3B Instruct locally

Upload your own business documents for AI-powered responses (RAG)

Deploy a fully functional AI chatbot in minutes

Perfect for businesses of any size and personal automation use cases.

📌 Overview

Ellstack provides a complete local AI + WhatsApp automation ecosystem:
Unified backend + frontend workflow
Windows installer (Win32/Win64)
Built-in RAG (Retrieval-Augmented Generation)
Local AI inference engine (optimized ~80% faster than Ollama)
Production-ready architecture
Zero recurring API costs

🔥 Why Ellstack?

✅ No OpenAI credits
✅ No Claude credits
✅ No WhatsApp Cloud API billing
✅ No GPU required
✅ Full data privacy (everything runs locally)
✅ One-time installation

🚀 Core Features
🧠 Local AI Engine

Runs Llama 3.2 3B Instruct
Optimized inference (faster than Ollama)
No external API dependency
Redis-based conversation memory caching
💬 WhatsApp Integration
Whatsapp QR code device pairing
Send & receive WhatsApp messages
Automatic AI-generated responses
Built using Baileys + custom backend logic

📂 RAG Document Processing

Upload and use business documents as knowledge base:
Supported formats:

.PDF
.DOCX
.TXT
.XLS
.CSV

The bot uses your documents to answer customer FAQs and business queries intelligently.

🗄 Local Database

SQLite storage
Stores:

WhatsApp inbound/outbound messages
App settings
Bot activity logs
Monitor chatbot performance locally

⚙️ Amigo Setup App

Windows desktop configuration tool
Upload RAG files
Configure bot behavior
Connect WhatsApp device

🛠️ Quick Start

✅ Prerequisites

Windows 10 or higher (Win32 or Win64)

📥 Installation

Go to the Releases page.
Download the appropriate installer (Win32 / Win64).
Run the installer.
Open Ellstack Amigo from the Start Menu.
Upload your knowledge base documents.
Scan the QR code to link your WhatsApp.

Start responding with AI 🚀

📁 Project Structure
ellstack/
├── bin/                  # Model binaries and core services
├── rag_data/             # Documents used for RAG (PDF, Excel, TXT, CSV, DOCX)
├── data/                 # SQLite database (settings + WhatsApp messages)
├── whatsapp_server/      # Node.js backend (Baileys + custom logic)
├── README.md

📦 Releases

Stable versions and changelogs are available on the GitHub Releases page.

🔐 Architecture Overview

Node.js backend (WhatsApp server)
Local AI inference engine
Redis for conversation context caching
SQLite for persistent storage
Windows installer deployment
Fully offline-capable AI processing

🎯 Use Cases

Customer support automation
FAQ auto-response
Internal company knowledge bot
Small business WhatsApp assistant
AI assistant without monthly costs
Private AI chatbot for sensitive data

💡 Vision

Ellstack Amigo aims to democratize AI by:
Removing dependency on expensive API providers
Preserving data privacy
Making AI accessible on regular hardware

Enabling businesses to own their AI infrastructure
