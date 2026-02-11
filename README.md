# 🎵 Resonance

<p align="center">
  <img src="https://img.shields.io/badge/PHP-8.2+-777BB4?style=for-the-badge&logo=php&logoColor=white" alt="PHP 8.2+">
  <img src="https://img.shields.io/badge/WebSocket-Ratchet-4479A1?style=for-the-badge&logo=websocket&logoColor=white" alt="WebSocket">
  <img src="https://img.shields.io/badge/WebRTC-Peer--to--Peer-333333?style=for-the-badge&logo=webrtc&logoColor=white" alt="WebRTC">
  <img src="https://img.shields.io/badge/License-MIT-green?style=for-the-badge" alt="License">
</p>

<p align="center">
  <strong>Eine private, selbst-gehostete Chat-Plattform – weil Privatsphäre kein Luxus sein sollte.</strong>
</p>

---

## 📖 Über das Projekt

**Resonance** ist eine moderne, selbst-gehostete Alternative zu Discord und ähnlichen Plattformen. Das Projekt entstand als Antwort auf die zunehmenden Anforderungen großer Plattformen nach ID- und Gesichtsverifizierung, die viele Nutzer als übertriebene Eingriffe in ihre Privatsphäre empfinden.

### 🎯 Warum Resonance?

- **🔒 Privatsphäre an erster Stelle** – Keine ID-Verifizierung, keine Gesichtserkennung, keine Datensammlung
- **🏠 Volle Kontrolle** – Hoste es auf deinem eigenen Server und behalte die volle Kontrolle über deine Daten
- **🆓 Open Source** – Der komplette Code ist einsehbar und anpassbar
- **👥 Für kleine Communities** – Perfekt für Freundesgruppen, Teams oder private Gemeinschaften

---

## ✨ Features

### 💬 Text-Kommunikation
- **Echtzeit-Nachrichten** über WebSocket
- **Kategorien & Kanäle** – Organisiere deine Kommunikation wie bei Discord
- **Direktnachrichten (DMs)** – Private 1:1 Konversationen mit Freunden
- **Nachrichtenbearbeitung & -löschung** – Volle Kontrolle über deine Nachrichten
- **Gepinnte Nachrichten** – Wichtige Nachrichten hervorheben
- **Datei-Uploads** – Bilder und Dateien als Anhänge versenden
- **Typing-Indikatoren** – Sehe, wer gerade tippt
- **Nachrichtensuche** – Durchsuche alle Kanäle nach Inhalten

### 🎙️ Voice-Chat
- **WebRTC Voice-Kanäle** – Echtzeit-Sprachkommunikation mit niedriger Latenz
- **Peer-to-Peer Verbindungen** – Direkte Verbindung zwischen Teilnehmern
- **Stummschaltung & Taubstellung** – Volle Audio-Kontrolle
- **Sprechindikator (VAD)** – Visuelle Anzeige wer gerade spricht
- **Kamera-Unterstützung** – Video-Feeds in Voice-Kanälen
- **Bildschirmfreigabe** – Teile deinen Bildschirm mit anderen
- **DM Voice Calls** – Private Sprachanrufe mit Freunden
- **Soundboard** – Spiele Sounds im Voice-Channel ab

### 👥 Soziale Features
- **Freundschaftssystem** – Sende und verwalte Freundschaftsanfragen
- **Benutzerprofile** – Anpassbare Profile mit Avatar, Banner und Bio
- **Benutzerdefinierte Status** – Zeige deinen aktuellen Status an
- **Online-/Offline-Status** – Echtzeit-Präsenzanzeige
- **Benutzerkarten** – Schneller Blick auf Benutzerinformationen

### 🛡️ Administration
- **Rollen & Berechtigungen** – Granulares Berechtigungssystem
- **Invite-Codes** – Kontrolliere wer beitreten kann
- **Benutzerverwaltung** – Verwalte alle registrierten Nutzer
- **Kanal-Management** – Erstelle, bearbeite und lösche Kanäle
- **Moderations-Tools** – Kick-/Ban-Funktionen und Nachrichtenverwaltung

---

## 🛠️ Tech Stack

| Komponente | Technologie |
|------------|-------------|
| **Backend** | PHP 8.2+ |
| **Template Engine** | Twig 3.x |
| **WebSocket Server** | Ratchet / ReactPHP |
| **Echtzeit-Kommunikation** | WebSocket + WebRTC |
| **Datenbank** | MySQL 8.0+ / MariaDB 10.5+ |
| **Styling** | TailwindCSS |
| **Icons** | Material Icons |

---

## 📋 Voraussetzungen

- **PHP 8.2** oder höher
- **Composer** für PHP-Abhängigkeiten
- **MySQL 8.0+** oder **MariaDB 10.5+**
- Ein Webserver (Apache, Nginx, oder PHPs eingebauter Server für Entwicklung)

---

## 🚀 Installation

### 1. Repository klonen

```bash
git clone https://github.com/nasty-codes-software/resonance.git
cd resonance
```

### 2. Abhängigkeiten installieren

```bash
composer install
```

### 3. Umgebungsvariablen konfigurieren

Erstelle eine `.env` Datei im Projektverzeichnis:

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=resonance
DB_USER=your_username
DB_PASS=your_password

# Application Settings
APP_NAME=Resonance
APP_URL=http://localhost:8080
APP_DEBUG=true

# WebSocket Server
WS_HOST=0.0.0.0
WS_PORT=8081
WS_URL=ws://localhost:8081
```

### 4. Datenbank einrichten

```bash
mysql -u root -p < database/schema.sql
```

Dies erstellt alle Tabellen und fügt Standarddaten ein:
- **Standard-Admin-Benutzer**: `admin@resonance.local` / `password`
- **Standard-Rollen**: Admin, Moderator, Member
- **Beispiel-Kategorien und -Kanäle**

### 5. Server starten

**Entwicklungsumgebung:**

Terminal 1 - Webserver:
```bash
composer start
# oder
php -S localhost:8080 -t public
```

Terminal 2 - WebSocket-Server:
```bash
composer websocket
# oder
php bin/websocket-server.php
```

Die Anwendung ist dann erreichbar unter: `http://localhost:8080`

---

## 🌐 Produktions-Deployment

### Systemd Services (Linux)

Erstelle Systemd-Services für den automatischen Start:

**WebSocket-Server** (`/etc/systemd/system/resonance-ws.service`):
```ini
[Unit]
Description=Resonance WebSocket Server
After=network.target mysql.service

[Service]
Type=simple
User=www-data
WorkingDirectory=/var/www/resonance
ExecStart=/usr/bin/php bin/websocket-server.php
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable resonance-ws
sudo systemctl start resonance-ws
```

### Nginx Konfiguration

**Haupt-Anwendung + WebSocket Reverse Proxy:**

```nginx
# HTTP -> HTTPS Redirect
server {
    listen 80;
    server_name chat.example.com;
    return 301 https://$server_name$request_uri;
}

# HTTPS Server
server {
    listen 443 ssl http2;
    server_name chat.example.com;

    # SSL Zertifikate (z.B. Let's Encrypt)
    ssl_certificate /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256;
    ssl_prefer_server_ciphers off;

    root /var/www/resonance/public;
    index index.php;

    # Haupt-Anwendung
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }

    # PHP-FPM
    location ~ \.php$ {
        fastcgi_pass unix:/var/run/php/php8.2-fpm.sock;
        fastcgi_param SCRIPT_FILENAME $realpath_root$fastcgi_script_name;
        include fastcgi_params;
    }

    # Uploads
    location /uploads {
        alias /var/www/resonance/public/uploads;
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # Statische Assets
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2)$ {
        expires 7d;
        add_header Cache-Control "public, immutable";
    }

    # Sicherheit
    location ~ /\. {
        deny all;
    }
}

# WebSocket Reverse Proxy (separater Port oder Subdomain)
server {
    listen 443 ssl http2;
    server_name ws.chat.example.com;

    ssl_certificate /etc/letsencrypt/live/chat.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/chat.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        
        # WebSocket-spezifische Header
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket Timeouts (wichtig für lange Verbindungen)
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 60s;
    }
}
```

**Alternative: WebSocket auf gleichem Host (Pfad-basiert):**

```nginx
server {
    listen 443 ssl http2;
    server_name chat.example.com;
    
    # ... SSL und andere Konfiguration wie oben ...

    # WebSocket auf /ws Pfad
    location /ws {
        proxy_pass http://127.0.0.1:8081;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }

    # Alles andere zur PHP-App
    location / {
        try_files $uri $uri/ /index.php?$query_string;
    }
    
    # ... PHP-FPM Konfiguration ...
}
```

### Apache Konfiguration

```apache
<VirtualHost *:443>
    ServerName chat.example.com
    DocumentRoot /var/www/resonance/public

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/chat.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/chat.example.com/privkey.pem

    <Directory /var/www/resonance/public>
        AllowOverride All
        Require all granted
    </Directory>

    # PHP-FPM
    <FilesMatch \.php$>
        SetHandler "proxy:unix:/var/run/php/php8.2-fpm.sock|fcgi://localhost"
    </FilesMatch>
</VirtualHost>

# WebSocket Proxy (benötigt mod_proxy_wstunnel)
<VirtualHost *:443>
    ServerName ws.chat.example.com

    SSLEngine on
    SSLCertificateFile /etc/letsencrypt/live/chat.example.com/fullchain.pem
    SSLCertificateKeyFile /etc/letsencrypt/live/chat.example.com/privkey.pem

    # WebSocket Proxy
    ProxyRequests Off
    ProxyPreserveHost On
    
    RewriteEngine On
    RewriteCond %{HTTP:Upgrade} websocket [NC]
    RewriteCond %{HTTP:Connection} upgrade [NC]
    RewriteRule ^/?(.*) ws://127.0.0.1:8081/$1 [P,L]

    ProxyPass / http://127.0.0.1:8081/
    ProxyPassReverse / http://127.0.0.1:8081/
</VirtualHost>
```

Apache Module aktivieren:
```bash
sudo a2enmod proxy proxy_http proxy_wstunnel rewrite ssl
sudo systemctl restart apache2
```

### Produktions-Umgebungsvariablen

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=3306
DB_NAME=resonance
DB_USER=resonance_user
DB_PASS=sicheres_passwort_hier

# Application Settings
APP_NAME=Resonance
APP_URL=https://chat.example.com
APP_DEBUG=false

# WebSocket Server
WS_HOST=127.0.0.1
WS_PORT=8081
WS_URL=wss://ws.chat.example.com
# oder bei Pfad-basiertem Setup:
# WS_URL=wss://chat.example.com/ws
```

### Firewall-Konfiguration (UFW)

```bash
# Nur HTTP/HTTPS öffnen - WebSocket läuft intern
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# WebSocket-Port NICHT öffentlich öffnen (läuft über Reverse Proxy)
# sudo ufw allow 8081/tcp  # NUR für direkten Zugriff ohne Reverse Proxy
```

### SSL-Zertifikate mit Let's Encrypt

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d chat.example.com -d ws.chat.example.com
```

### Wichtige Hinweise für Produktion

1. **WebSocket über WSS**: Nutze immer `wss://` (WebSocket Secure) in Produktion
2. **Timeouts**: Stelle sicher, dass Proxy-Timeouts lang genug sind (86400s = 24h)
3. **Keep-Alive**: WebSocket-Verbindungen müssen lange offen bleiben können
4. **PHP-FPM Tuning**: Passe `pm.max_children` an deine erwartete Nutzerzahl an
5. **MySQL Tuning**: `max_connections` erhöhen bei vielen gleichzeitigen Nutzern
6. **Logging**: Aktiviere Error-Logging für Debugging

---

## 📁 Projektstruktur

```
resonance/
├── bin/
│   └── websocket-server.php    # WebSocket-Server Einstiegspunkt
├── database/
│   └── schema.sql              # Datenbankschema mit Standarddaten
├── public/
│   ├── index.php               # Front Controller
│   ├── assets/
│   │   ├── css/app.css         # Styles
│   │   └── js/
│   │       ├── app.js          # Haupt-App Controller
│   │       ├── auth.js         # Authentifizierung
│   │       ├── friends.js      # Freundes-System
│   │       ├── soundboard.js   # Soundboard
│   │       ├── webrtc.js       # WebRTC Voice/Video
│   │       └── websocket.js    # WebSocket Client
│   └── uploads/                # Benutzer-Uploads
├── src/
│   ├── Controllers/
│   │   ├── Api/                # API-Controller
│   │   └── ...                 # Web-Controller
│   ├── Core/                   # Framework-Kern
│   │   ├── Container.php
│   │   ├── Database.php
│   │   ├── Request.php
│   │   ├── Response.php
│   │   ├── Router.php
│   │   ├── Session.php
│   │   └── View.php
│   ├── Models/                 # Datenmodelle
│   └── WebSocket/
│       └── ChatServer.php      # WebSocket-Server Logik
├── storage/
│   ├── attachments/            # Nachrichtenanhänge
│   ├── cache/                  # Twig-Cache
│   └── sounds/                 # Soundboard-Dateien
├── templates/                  # Twig-Templates
└── vendor/                     # Composer-Abhängigkeiten
```

---

## 🔧 API-Endpunkte

### Authentifizierung
| Methode | Endpunkt | Beschreibung |
|---------|----------|--------------|
| GET | `/login` | Login-Seite anzeigen |
| POST | `/login` | Benutzer einloggen |
| GET | `/register` | Registrierungsseite anzeigen |
| POST | `/register` | Neuen Benutzer registrieren |
| GET | `/logout` | Benutzer ausloggen |

### Kanäle
| Methode | Endpunkt | Beschreibung |
|---------|----------|--------------|
| GET | `/api/channels` | Alle Kanäle abrufen |
| POST | `/api/channels` | Neuen Kanal erstellen |
| GET | `/api/channels/{id}` | Einzelnen Kanal abrufen |
| PUT | `/api/channels/{id}` | Kanal aktualisieren |
| DELETE | `/api/channels/{id}` | Kanal löschen |
| GET | `/api/channels/{id}/messages` | Nachrichten abrufen |

### Voice
| Methode | Endpunkt | Beschreibung |
|---------|----------|--------------|
| GET | `/api/voice` | Alle Voice-Kanäle abrufen |
| POST | `/api/voice/{id}/join` | Voice-Kanal beitreten |
| POST | `/api/voice/leave` | Voice-Kanal verlassen |

### Freunde
| Methode | Endpunkt | Beschreibung |
|---------|----------|--------------|
| GET | `/api/friends` | Freundesliste abrufen |
| POST | `/api/friends/request` | Freundschaftsanfrage senden |
| POST | `/api/friends/request/{id}/accept` | Anfrage annehmen |
| DELETE | `/api/friends/{id}` | Freund entfernen |

---

## 🔐 Berechtigungssystem

Resonance verfügt über ein flexibles Rollen- und Berechtigungssystem:

### Standard-Rollen
| Rolle | Farbe | Beschreibung |
|-------|-------|--------------|
| **Admin** | 🔴 Rot | Voller Zugriff auf alle Funktionen |
| **Moderator** | 🔵 Blau | Moderation und Benutzerverwaltung |
| **Member** | ⚪ Grau | Basis-Zugriff |

### Verfügbare Berechtigungen
- `administrator` - Voller Zugriff
- `manage_channels` - Kanäle verwalten
- `manage_roles` - Rollen verwalten
- `kick_members` / `ban_members` - Moderationsrechte
- `send_messages` - Nachrichten senden
- `manage_messages` - Nachrichten anderer verwalten
- `use_voice` / `speak` - Voice-Funktionen
- `mute_members` / `deafen_members` / `move_members` - Voice-Moderation
- `manage_sounds` - Soundboard verwalten

---

## 🔊 WebSocket-Events

Der WebSocket-Server unterstützt folgende Event-Typen:

| Event | Beschreibung |
|-------|--------------|
| `auth` | Benutzer authentifizieren |
| `chat_message` | Nachricht senden |
| `dm_message` | Direktnachricht senden |
| `join_channel` / `leave_channel` | Text-Kanal betreten/verlassen |
| `join_voice` / `leave_voice` | Voice-Kanal betreten/verlassen |
| `webrtc_offer` / `webrtc_answer` / `webrtc_ice` | WebRTC-Signaling |
| `typing` / `dm_typing` | Tipp-Indikator |
| `speaking` | Sprachaktivität |
| `camera_state` | Kamera-Status |
| `screen_share_state` | Bildschirmfreigabe-Status |
| `play_sound` | Soundboard-Sound abspielen |
| `friend_request` | Freundschaftsanfrage |
| `dm_call_invite` / `dm_call_response` | DM-Anrufe |

---

## 🤝 Beitragen

Beiträge sind willkommen! Bitte beachte:

1. Forke das Repository
2. Erstelle einen Feature-Branch (`git checkout -b feature/AmazingFeature`)
3. Committe deine Änderungen (`git commit -m 'Add some AmazingFeature'`)
4. Pushe zum Branch (`git push origin feature/AmazingFeature`)
5. Öffne einen Pull Request

---

## 📜 Lizenz

Dieses Projekt ist unter der MIT-Lizenz lizenziert - siehe [LICENSE](LICENSE) für Details.

---

## ⚠️ Hinweis

Resonance ist für den **privaten Gebrauch** und **kleine Communities** konzipiert. Es ist kein Ersatz für großflächige Plattformen und sollte verantwortungsvoll genutzt werden. Der Betreiber einer Resonance-Instanz ist für die Inhalte auf seiner Plattform verantwortlich.

---

<p align="center">
  <strong>Made with ❤️ for Privacy</strong><br>
  <em>Weil jeder das Recht auf private Kommunikation hat.</em>
</p>
