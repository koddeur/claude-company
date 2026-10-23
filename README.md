# Claude Company

Bureau pixel art qui montre en direct ce que font tes sessions Claude Code.

```bash
npm start            # http://127.0.0.1:4747
# démo sans agents réels : http://127.0.0.1:4747/?demo
```

Zéro dépendance. Le serveur lit **en lecture seule** les transcripts `~/.claude/projects/**/*.jsonl`,
n'écoute que sur `127.0.0.1` (sauf `npm run mobile`, protégé par jeton), et n'envoie au navigateur que des libellés courts
(description des commandes Bash, nom de fichier, requête) : jamais le contenu des fichiers ni les commandes brutes.

## Sur mobile

```bash
npm run mobile       # écoute sur le réseau local, protégé par un jeton
```

Le terminal affiche une URL `http://<ip>:4747/?token=…` : ouvre-la sur ton téléphone (même Wi-Fi). Le jeton passe ensuite dans un cookie et disparaît de l'URL. Ajoute la page à l'écran d'accueil pour l'avoir en plein écran.
Un nouveau jeton est généré à chaque lancement ; pour en garder un fixe : `CLAUDE_COMPANY_TOKEN=<hex> npm run mobile`.
Le trafic est en HTTP clair : à réserver à un réseau de confiance (ou passer par Tailscale).

Sur petit écran, le bureau s'affiche par aile (Code · Web, Biblio · Réunion, Serveurs · Café) : glisse ou touche les onglets. La fiche d'un agent s'ouvre en panneau qui monte du bas de l'écran.

## Ouvrir la fenêtre d'un agent

Dans la fiche d'un agent, le bouton « Ouvrir » passe au premier plan la fenêtre où tourne sa session (lue dans `~/.claude/sessions/`) :
l'onglet exact pour Terminal.app, l'application sinon (Ghostty, Claude Desktop, HyperFrames…).
Uniquement depuis le navigateur du Mac (`127.0.0.1`) : la route refuse toute autre origine et le bouton est masqué sur mobile.

Ces mêmes fichiers donnent l'état déclaré par Claude Code (`busy` / `idle`), qui prime sur la déduction faite depuis les transcripts.
Seules les sessions **ouvertes** sont affichées ; les sous-agents, tant que leur session est ouverte et qu'ils ont travaillé dans les 5 dernières minutes.

## Pièces = type de tâche

| Pièce | Outils |
|---|---|
| Atelier code | Edit, Write, MultiEdit, NotebookEdit |
| Bibliothèque | Read, Grep, Glob, Skill, ToolSearch |
| Salle serveurs | Bash, Monitor |
| Veille web | WebSearch, WebFetch, outils MCP |
| Réunion | Agent/Task (délègue), TodoWrite, plan |
| Cafétéria | t'attend (fin de tour, AskUserQuestion) ou en pause (>15 min) |

## États

- **au travail** : un outil est en cours
- **réfléchit** : entre deux outils
- **t'attend** : tour terminé ou question posée
- **bloqué ?** : outil sans résultat depuis 90 s (souvent une permission en attente ; Bash et Agent exclus)
- **en pause** : inactif depuis 15 min

## Contexte et quota

- **Contexte par session** : lu dans les transcripts (`usage` du dernier message). Sans la statusline, la taille de la fenêtre est estimée (200k, ou 1M au-delà de 200k).
- **Quota 5 h / 7 jours et contexte exact** : Claude Code ne les transmet qu'à la statusline. Ajouter juste après `input=$(cat)` dans `~/.claude/statusline-command.sh` :

```bash
# Claude Company : contexte + quota (aucun secret dans ces champs)
mkdir -p ~/.claude/claude-company/status && echo "$input" | jq -c '{session_id, context_window, rate_limits}' > ~/.claude/claude-company/status/"$(echo "$input" | jq -r '.session_id')".json 2>/dev/null
```

Le quota affiché est celui de la session dont la statusline s'est rafraîchie le plus récemment.

## Options

`PORT` (4747), `WINDOW_MIN` (120 : fraîcheur max des données statusline), `CLAUDE_PROJECTS_DIR`.

## Limites connues

- Les sous-agents sont lus depuis `<session>/subagents/*.jsonl` : format non vérifié sur données réelles.
- Les états sont déduits des transcripts : un état « bloqué ? » est une supposition.
