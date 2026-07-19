# Privacy Policy — Deutsch · Italiano · Português

**BlackHolock** · Version 1.0.0 · 19. Juli 2026

Diese Datei ergänzt die [Hauptfassung](PRIVACY.md) (English · Türkçe · Español).
Questo file integra la [versione principale](PRIVACY.md).
Este arquivo complementa a [versão principal](PRIVACY.md).

[Deutsch](#deutsch) · [Italiano](#italiano) · [Português](#português)

---

## Deutsch

### Kurzfassung

BlackHolock hat keine Konten, keine Server und keine Analyse. Es erhebt,
überträgt und verkauft keine personenbezogenen Daten. Alles, was die App über
dich weiß, bleibt auf deinem Gerät.

### Was die App speichert

Eine einzige Datei, ausschließlich auf deinem Rechner:

| Was | Wo |
| --- | --- |
| Deine Einstellungen (Zeiten, Sprache, Effekt, Schalter) | `settings.json` im Anwendungsdaten-Ordner |

Unter macOS: `~/Library/Application Support/BlackHolock/`
Unter Windows: `%APPDATA%\BlackHolock\`

Sonst wird nichts geschrieben. Es gibt keinen Nutzungsverlauf, kein
Sitzungsprotokoll, keinerlei Kennung und keinen Absturzberichtsdienst.

### Was dein Gerät verlässt

Genau eine Sache, und nur wenn du **Nach Updates suchen** aktiviert lässt:

- Eine anonyme HTTPS-`GET`-Anfrage an die öffentliche GitHub-Releases-API, um
  die neueste veröffentlichte Versionsnummer zu lesen.

Diese Anfrage enthält kein Konto, keine Gerätekennung und keine Informationen
über dich, die über das hinausgehen, was jede Webanfrage dem empfangenden
Server unvermeidlich preisgibt (deine IP-Adresse und dein User-Agent, von
GitHub nach dessen eigener Datenschutzerklärung verarbeitet). Das Abschalten
der Einstellung unterbindet die Anfrage vollständig; die App bleibt voll
funktionsfähig.

### Bildschirmaufnahme-Berechtigung

Wenn du **Schreibtisch krümmen** aktivierst, fragt die App dein Betriebssystem
nach der Berechtigung zur Bildschirmaufnahme. Sie dient ausschließlich dazu,
die Pixel deines Bildschirms in den Grafikspeicher zu lesen und sie dort in
Echtzeit auf deinem eigenen Rechner zu verzerren.

Diese Einzelbilder werden **nie** auf die Festplatte geschrieben, nie kodiert,
über das gerade gezeichnete Bild hinaus nie zwischengespeichert und nirgendwohin
übertragen. Sobald der Effekt vom Bildschirm verschwindet, wird die Aufnahme
gestoppt und der Speicher freigegeben. Du kannst die Berechtigung jederzeit in
den Datenschutzeinstellungen deines Systems widerrufen; die App läuft dann ohne
die Verzerrung weiter.

### Deine Rechte (DSGVO)

Da BlackHolock keine personenbezogenen Daten verarbeitet und keine
Verantwortlichen-Infrastruktur betreibt, gibt es keine personenbezogenen Daten,
auf die zugegriffen werden könnte oder die zu berichtigen, zu übertragen,
einzuschränken oder zu löschen wären. Nach der Datenschutz-Grundverordnung
(DSGVO) bedeutet das praktisch:

- Die Nutzung der App begründet **kein Verantwortlichkeitsverhältnis**.
- Es ist **keine Einwilligung** erforderlich, weil keine Verarbeitung
  stattfindet.
- **Das Löschen der App** samt dem oben genannten Einstellungsordner entfernt
  jede Spur davon von deinem Gerät.

Nutzt du die Update-Prüfung, handelt GitHub für diese Anfrage als eigenständig
Verantwortlicher nach seiner eigenen Erklärung.

### Kinder

Die App erhebt von niemandem etwas und ist daher für Nutzerinnen und Nutzer
jeden Alters gleichermaßen unbedenklich.

### Änderungen

Wesentliche Änderungen dieser Erklärung werden im Repository mit neuer
Versionsnummer und neuem Datum veröffentlicht. Es gilt die Fassung, die der bei
dir installierten Version beiliegt.

### Kontakt

Öffne ein öffentliches Issue unter
<https://github.com/GhostFelina/BlackHolePomodoro/issues>.

---

## Italiano

### In breve

BlackHolock non ha account, né server, né analisi. Non raccoglie, non trasmette
e non vende alcun dato personale. Tutto ciò che l'app sa di te resta sul tuo
dispositivo.

### Cosa memorizza l'app

Un solo file, unicamente sul tuo computer:

| Cosa | Dove |
| --- | --- |
| Le tue impostazioni (durate, lingua, effetto, interruttori) | `settings.json` nella cartella dati applicazioni del sistema |

Su macOS: `~/Library/Application Support/BlackHolock/`
Su Windows: `%APPDATA%\BlackHolock\`

Non viene scritto nient'altro. Non c'è cronologia d'uso, né registro delle
sessioni, né identificatori di alcun tipo, né servizio di segnalazione errori.

### Cosa lascia il tuo dispositivo

Esattamente una cosa, e solo se lasci attiva l'opzione **Cerca aggiornamenti**:

- Una richiesta HTTPS `GET` anonima all'API pubblica delle Release di GitHub per
  leggere il numero dell'ultima versione pubblicata.

Quella richiesta non contiene account, né identificatori del dispositivo, né
informazioni su di te oltre a ciò che qualsiasi richiesta web rivela
inevitabilmente al server destinatario (il tuo indirizzo IP e il tuo user
agent, trattati da GitHub secondo la propria informativa). Disattivare
l'opzione interrompe del tutto la richiesta e l'app resta pienamente
funzionante.

### Permesso di registrazione dello schermo

Se attivi **Curva la scrivania**, l'app chiede al sistema operativo il permesso
di catturare lo schermo. Serve solo a leggere i pixel del tuo schermo nella
memoria grafica per deformarli in tempo reale, sulla tua macchina.

Quei fotogrammi **non** vengono mai scritti su disco, mai codificati, mai messi
in buffer oltre il singolo fotogramma in disegno e mai trasmessi da nessuna
parte. Appena l'effetto lascia lo schermo, la cattura viene fermata e la memoria
liberata. Puoi revocare il permesso in qualsiasi momento dalle impostazioni di
privacy del sistema; l'app continuerà a funzionare senza la deformazione.

### I tuoi diritti (GDPR)

Poiché BlackHolock non tratta dati personali e non gestisce alcuna
infrastruttura da titolare del trattamento, non esistono dati personali a cui
accedere né da rettificare, portare, limitare o cancellare. Ai sensi del
Regolamento generale sulla protezione dei dati (GDPR), in pratica:

- L'uso dell'app **non instaura un rapporto di titolarità del trattamento**.
- **Non è richiesto alcun consenso**, perché non avviene alcun trattamento.
- **Disinstallare l'app**, insieme alla cartella delle impostazioni indicata
  sopra, rimuove ogni sua traccia dal dispositivo.

Se usi il controllo aggiornamenti, GitHub agisce come titolare autonomo per
quella richiesta, secondo la propria informativa.

### Minori

L'app non raccoglie nulla da nessuno ed è quindi ugualmente sicura per utenti di
qualsiasi età.

### Modifiche

Le modifiche sostanziali a questa informativa saranno pubblicate nel repository
con un nuovo numero di versione e una nuova data. Vale la versione distribuita
con la release che hai installato.

### Contatti

Apri una segnalazione pubblica su
<https://github.com/GhostFelina/BlackHolePomodoro/issues>.

---

## Português

### Versão curta

O BlackHolock não tem contas, nem servidores, nem análises. Ele não coleta, não
transmite e não vende nenhum dado pessoal. Tudo o que o aplicativo sabe sobre
você permanece no seu dispositivo.

### O que o aplicativo armazena

Um único arquivo, apenas no seu computador:

| O quê | Onde |
| --- | --- |
| Suas configurações (durações, idioma, efeito, chaves) | `settings.json` na pasta de dados de aplicativos do sistema |

No macOS: `~/Library/Application Support/BlackHolock/`
No Windows: `%APPDATA%\BlackHolock\`

Nada mais é gravado. Não há histórico de uso, nem registro de sessões, nem
identificador de qualquer tipo, nem serviço de relatório de falhas.

### O que sai do seu dispositivo

Exatamente uma coisa, e somente se você deixar **Procurar atualizações**
ativado:

- Uma requisição HTTPS `GET` anônima à API pública de Releases do GitHub para
  ler o número da versão mais recente publicada.

Essa requisição não contém conta, nem identificador de dispositivo, nem
informações sobre você além do que qualquer requisição web inevitavelmente
revela ao servidor de destino (seu endereço IP e seu user agent, tratados pelo
GitHub sob a política dele). Desativar a opção interrompe a requisição por
completo, e o aplicativo continua plenamente funcional.

### Permissão de gravação de tela

Se você ativar **Curvar a área de trabalho**, o aplicativo pede ao sistema
operacional a permissão de captura de tela. Ela é usada apenas para ler os
pixels da sua tela na memória gráfica e distorcê-los em tempo real, na sua
própria máquina.

Esses quadros **nunca** são gravados em disco, nunca são codificados, nunca são
armazenados além do único quadro sendo desenhado e nunca são transmitidos para
lugar algum. No instante em que o efeito sai da tela, a captura é interrompida e
a memória é liberada. Você pode revogar a permissão a qualquer momento nas
configurações de privacidade do sistema; o aplicativo então funciona sem a
distorção.

### Seus direitos (LGPD / GDPR)

Como o BlackHolock não trata dados pessoais e não opera nenhuma infraestrutura
de controlador, não existem dados pessoais a acessar, corrigir, portar,
restringir ou eliminar. Sob a Lei Geral de Proteção de Dados (LGPD, Lei
13.709/2018) e o Regulamento Geral de Proteção de Dados (GDPR), na prática:

- O uso do aplicativo **não cria relação de controlador de dados**.
- **Não é necessário consentimento**, porque nenhum tratamento ocorre.
- **Desinstalar o aplicativo**, junto com a pasta de configurações indicada
  acima, remove todo vestígio dele do seu dispositivo.

Se você usar a verificação de atualizações, o GitHub atua como controlador
independente para aquela requisição, conforme a política dele.

### Crianças

O aplicativo não coleta nada de ninguém e, portanto, é igualmente seguro para
usuários de qualquer idade.

### Alterações

Mudanças materiais nesta política serão publicadas no repositório com novo
número de versão e nova data. Vale a versão que acompanha a release instalada.

### Contato

Abra uma issue pública em
<https://github.com/GhostFelina/BlackHolePomodoro/issues>.
