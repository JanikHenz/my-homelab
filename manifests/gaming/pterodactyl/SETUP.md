# Pterodactyl Setup Guide

Diese Anleitung beschreibt die Erstkonfiguration von Pterodactyl nach dem Deployment.

## Voraussetzungen

- Kubernetes Cluster läuft
- ArgoCD hat Pterodactyl deployed
- Docker ist auf dem Homeserver installiert (für Wings)

## Schritt 1: Secrets anpassen

Vor dem ersten Deployment müssen die Secrets generiert werden:

```bash
# Generiere Passwörter
openssl rand -base64 32  # root-password für MariaDB
openssl rand -base64 32  # password für MariaDB
openssl rand -base64 32  # app-key (ohne base64: Präfix)
```

Bearbeite `pterodactyl-secrets.yaml` und trage die Werte ein:

```yaml
stringData:
  mariadb-root-password: "GENERIERTES_PASSWORT_1"
  mariadb-password: "GENERIERTES_PASSWORT_2"
  app-key: "base64:GENERIERTER_KEY_3"
  admin-password: "dein-admin-passwort"
```

Wende die Secrets an:

```bash
kubectl apply -f manifests/gaming/pterodactyl/pterodactyl-secrets.yaml
```

## Schritt 2: Verzeichnisse erstellen

Auf dem Homeserver müssen die Verzeichnisse für die Persistent Volumes erstellt werden:

```bash
# Auf dem Homeserver ausführen
sudo mkdir -p /mnt/data/pterodactyl/panel/config
sudo mkdir -p /mnt/data/pterodactyl/panel/database
sudo mkdir -p /mnt/data/pterodactyl/wings/config
sudo mkdir -p /mnt/data/pterodactyl/servers

# Berechtigungen setzen
sudo chown -R 1000:1000 /mnt/data/pterodactyl/
```

## Schritt 3: Erstkonfiguration Panel

### 3.1 Auf das Panel zugreifen

- Öffne `https://pterodactyl.janikhenz.ch`
- Oder lokal: `http://homeserver:30020`

### 3.2 Admin-Account erstellen

Beim ersten Zugriff wird ein Setup-Bildschirm angezeigt:

1. Gib die Admin-Daten ein:
   - Username: `admin`
   - Email: `admin@janikhenz.ch`
   - Password: (aus dem Secret)

2. Fülle die Firmeninformationen aus (kann später geändert werden)

3. Warte auf die Initialisierung

## Schritt 4: Wings konfigurieren

### 4.1 Node im Panel erstellen

1. Gehe zu **Admin → Nodes → Create New**
2. Konfiguriere die Node:
   ```
   Name: homeserver
   Description: Homeserver Kubernetes Node
   Location: Home
   FQDN: homeserver
   Communication: HTTP (für internes Netz)
   Behind Proxy: Yes (wegen Cloudflare/Treafik)
   ```
3. Speichere die Node

### 4.2 Konfiguration generieren

1. Klicke auf die erstellte Node
2. Gehe zum Tab **Configuration**
3. Kopiere die Konfiguration

### 4.3 Config auf das PVC kopieren

Erstelle die config.yml auf dem Wings-PVC:

```bash
# Erstelle die Config-Datei lokal
cat > /tmp/config.yml << 'EOF'
# Füge hier die generierte Konfiguration aus dem Panel ein
EOF

# Kopiere in das Pod-Verzeichnis
kubectl cp /tmp/config.yml gaming/pterodactyl-wings-pod-name:/etc/pterodactyl/config.yml
```

Alternativ über den Node direkt:

```bash
# Direkt auf dem Homeserver
sudo nano /mnt/data/pterodactyl/wings/config/config.yml
# Füge die Konfiguration ein
```

### 4.4 Wings neustarten

```bash
kubectl rollout restart deployment pterodactyl-wings -n gaming
```

## Schritt 5: Verifizierung

### Prüfe die Logs

```bash
# Panel Logs
kubectl logs -n gaming deployment/pterodactyl-panel

# Wings Logs
kubectl logs -n gaming deployment/pterodactyl-wings

# MariaDB Logs
kubectl logs -n gaming deployment/pterodactyl-mariadb
```

### Prüfe die Verbindung

1. Im Panel: Gehe zu **Admin → Nodes**
2. Die Node sollte als **Healthy** angezeigt werden
3. Heartbeat sollte aktuell sein

## Schritt 6: Ersten Game Server erstellen

1. Gehe zu **Servers → Create New**
2. Wähle ein Nest (z. B. Minecraft, CS:GO)
3. Konfiguriere:
   - Name: `mein-minecraft-server`
   - Owner: dein Admin-Account
   - Node: `homeserver`
   - Memory: `4096` (4 GB)
   - Disk: `10000` (10 GB)
   - CPU: `100` (100%)
4. Erstelle den Server

## Schritt 7: Minecraft Server detailliert einrichten

### 7.1 Minecraft Nest und Eggs installieren

Pterodactyl benötigt "Eggs" (Vorlagen) für verschiedene Spiele. Für Minecraft:

1. Gehe zu **Admin → Nests**
2. Klicke auf **Import Egg**
3. Importiere das offizielle Minecraft Egg:
   ```
   https://raw.githubusercontent.com/parkervcp/eggs/master/game_eggs/minecraft/java/paper/egg-paper.json
   ```

Alternativ kannst du auch andere Minecraft-Varianten importieren:
- **Vanilla Minecraft**: `https://raw.githubusercontent.com/parkervcp/eggs/master/game_eggs/minecraft/java/vanilla/egg-vanilla.json`
- **Forge**: `https://raw.githubusercontent.com/parkervcp/eggs/master/game_eggs/minecraft/java/forge/egg-forge.json`
- **Fabric**: `https://raw.githubusercontent.com/parkervcp/eggs/master/game_eggs/minecraft/java/fabric/egg-fabric.json`

### 7.2 Minecraft Server erstellen

1. Gehe zu **Servers → Create New**
2. **Basic Details**:
   - **Server Name**: `Minecraft-Survival`
   - **Server Owner**: Wähle deinen Account
   - **Default Allocation**: Wähle eine verfügbare IP:Port Kombination (z.B. `192.168.1.100:25565`)
   - **Server Description**: `Mein Minecraft Survival Server`

3. **Allocation Management**:
   - **Node**: `homeserver`
   - **Additional Allocations**: Leer lassen (optional für zusätzliche Ports)

   **Hinweis zu Allocations**: Falls keine Allocations verfügbar sind, musst du zuerst welche erstellen:
   1. Gehe zu **Admin → Nodes → homeserver → Allocation**
   2. Klicke **Create New Allocations**
   3. **IP Address**: `192.168.1.100` (die IP-Adresse deines Homeservers im lokalen Netz)
   4. **Ports**: `25565-25575` (Portbereich für Minecraft Server)
   5. Klicke **Submit**
   
   **IP-Adresse ermitteln**: Falls du die IP nicht kennst, führe auf dem Homeserver aus:
   ```bash
   ip addr show | grep "inet " | grep -v 127.0.0.1
   ```

4. **Application Feature Limits**:
   - **Database Limit**: `0` (keine Datenbanken benötigt)
   - **Allocation Limit**: `1`
   - **Backup Limit**: `3`

5. **Resource Management**:
   - **Memory**: `4096` MB (4 GB - empfohlen für 10-20 Spieler)
   - **Swap**: `0` MB
   - **Disk Space**: `10240` MB (10 GB)
   - **Block IO Weight**: `500`
   - **CPU Limit**: `200` % (2 CPU Kerne)

6. **Nest Configuration**:
   - **Nest**: `Minecraft`
   - **Egg**: `Paper` (empfohlen für Performance)

7. **Docker Configuration**:
   - **Docker Image**: Wird automatisch gesetzt
   - **Startup Command**: Wird automatisch gesetzt

8. Klicke **Create Server**

### 7.3 Server-Konfiguration anpassen

Nach der Erstellung des Servers:

1. Gehe zu **Servers** und klicke auf deinen Minecraft Server
2. Navigiere zum **Startup** Tab
3. Konfiguriere die wichtigsten Variablen:

   - **Minecraft Version**: `1.20.4` (oder gewünschte Version)
   - **Server Jar File**: `server.jar`
   - **Build Number**: `latest` (für Paper)
   - **Java Version**: `17` (empfohlen für moderne Minecraft-Versionen)

4. **Environment Variables** anpassen:
   ```
   MINECRAFT_VERSION=1.20.4
   BUILD_NUMBER=latest
   SERVER_JARFILE=server.jar
   VANILLA_VERSION=latest
   ```

### 7.4 Server starten und konfigurieren

1. Gehe zum **Console** Tab
2. Klicke **Start** um den Server zu starten
3. Beim ersten Start wird die EULA akzeptiert werden müssen:
   - Warte bis der Download abgeschlossen ist
   - Der Server wird sich automatisch stoppen
   - Gehe zum **Files** Tab
   - Bearbeite `eula.txt` und ändere `eula=false` zu `eula=true`
   - Starte den Server erneut

4. **server.properties** konfigurieren:
   - Gehe zum **Files** Tab
   - Bearbeite `server.properties`
   - Wichtige Einstellungen:
     ```properties
     server-name=Mein Minecraft Server
     gamemode=survival
     difficulty=normal
     max-players=20
     online-mode=true
     white-list=false
     spawn-protection=16
     view-distance=10
     simulation-distance=10
     ```

### 7.5 Plugins installieren (nur für Paper/Spigot)

Wenn du Paper als Server-Software gewählt hast, kannst du Plugins installieren:

1. Gehe zum **Files** Tab
2. Navigiere zum `plugins` Ordner
3. Lade Plugin-JAR-Dateien hoch
4. Starte den Server neu

Empfohlene Plugins für den Anfang:
- **EssentialsX**: Grundlegende Befehle und Features
- **WorldEdit**: Welt-Bearbeitung
- **LuckPerms**: Berechtigungssystem
- **CoreProtect**: Logging und Rollback

### 7.6 Backups einrichten

1. Gehe zum **Backups** Tab
2. Klicke **Create Backup**
3. Gib einen Namen ein: `Initial-Setup`
4. Warte bis das Backup abgeschlossen ist

Automatische Backups können über Cron-Jobs oder Plugins wie **AutoSaveWorld** eingerichtet werden.

### 7.7 Spieler hinzufügen

**Als Operator hinzufügen:**
1. Gehe zum **Console** Tab
2. Führe folgenden Befehl aus:
   ```
   op dein-minecraft-username
   ```

**Whitelist aktivieren (optional):**
1. In der Console:
   ```
   whitelist on
   whitelist add spielername
   ```

### 7.8 Server-Zugriff testen

1. Öffne Minecraft (Java Edition)
2. Gehe zu **Multiplayer → Add Server**
3. **Server Address**: `192.168.1.100:25565` (oder die IP und Port-Nummer deines Servers)
4. Teste die Verbindung

## Minecraft Server Troubleshooting

### Server startet nicht

1. **Prüfe die Logs** im Console Tab:
   - Java-Version Konflikte
   - Ungenügend RAM
   - Korrupte JAR-Datei

2. **Häufige Lösungen**:
   ```bash
   # Mehr RAM zuweisen (im Panel unter Resources)
   # Java Version prüfen (im Startup Tab)
   # Server JAR neu herunterladen
   ```

### Performance-Probleme

1. **RAM erhöhen**: Mindestens 2GB, empfohlen 4GB+
2. **CPU-Limit erhöhen**: Minecraft ist CPU-intensiv
3. **View-Distance reduzieren**: In server.properties auf 8-10
4. **Paper verwenden**: Bessere Performance als Vanilla

### Verbindungsprobleme

1. **Port prüfen**: Standard ist 25565
2. **Firewall**: Stelle sicher, dass der Port offen ist
3. **Online-Mode**: Bei Problemen temporär auf `false` setzen

### Plugin-Fehler

1. **Kompatibilität prüfen**: Plugin-Version mit Server-Version abgleichen
2. **Abhängigkeiten**: Manche Plugins benötigen andere Plugins
3. **Logs prüfen**: Fehlermeldungen im Console Tab analysieren

## Troubleshooting

### Wings zeigt "Offline"

1. Prüfe die Logs:
   ```bash
   kubectl logs -n gaming deployment/pterodactyl-wings
   ```

2. Überprüfe die config.yml:
   - Token muss mit dem Panel übereinstimmen
   - API-URL muss erreichbar sein

3. Prüfe Docker auf dem Host:
   ```bash
   sudo docker ps
   ```

### Panel zeigt 500 Fehler

1. Prüfe die Datenbank-Verbindung:
   ```bash
   kubectl logs -n gaming deployment/pterodactyl-panel | grep -i error
   ```

2. Prüfe die Secrets:
   ```bash
   kubectl get secret pterodactyl-secrets -n gaming -o yaml
   ```

3. MariaDB prüfen:
   ```bash
   kubectl exec -it -n gaming deployment/pterodactyl-mariadb -- mysql -u pterodactyl -p
   # Passwort aus Secret eingeben
   SHOW DATABASES;
   ```

### Docker-Socket nicht erreichbar

Wings benötigt Zugriff auf den Docker-Socket:

```bash
# Prüfe ob Docker läuft
sudo systemctl status docker

# Prüfe Socket-Berechtigungen
ls -la /var/run/docker.sock
```

## Sicherheitshinweise

- Ändere das Admin-Passwort nach dem ersten Login
- Aktiviere 2FA im Panel für den Admin-Account
- Überprüfe regelmässig die Logs auf ungewöhnliche Aktivitäten
- Nutze nur verifizierte Egg-Templates aus dem Pterodactyl-Repository

## Nützliche Befehle

```bash
# Alle Pterodactyl Pods anzeigen
kubectl get pods -n gaming

# Panel durchstarten
kubectl rollout restart deployment pterodactyl-panel -n gaming

# Wings durchstarten
kubectl rollout restart deployment pterodactyl-wings -n gaming

# In den MariaDB Container
kubectl exec -it -n gaming deployment/pterodactyl-mariadb -- mysql -u root -p

# Storage prüfen
kubectl get pvc -n gaming
```
