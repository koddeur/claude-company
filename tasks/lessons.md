# Lessons

- Capture headless Chrome avec `--virtual-time-budget` fige `requestAnimationFrame` : les agents semblaient immobiles. Fix : capturer via Playwright avec une vraie attente.
- Le nom d'agent suivait le dernier `cwd` du transcript (un `cd` renommait l'agent). Fix : garder le premier `cwd` vu.
- Texte canvas flou : dessiné à 10 px logiques puis agrandi en CSS. Fix : rendu interne ×3 (setTransform) + Pixelify Sans en minuscules (ses majuscules grasses confondent C/O et B/8).
- Le quota d'abonnement (5 h / 7 j) n'est pas dans les transcripts : seule la statusline le reçoit. Fix : la statusline dépose un JSON filtré dans ~/.claude/claude-company/status, lu par le serveur.
- Taille de fenêtre estimée à 200k alors qu'Opus 5.5 est à 1M (80 % affiché au lieu de 17 %). Fix : reprendre la taille exacte donnée par la statusline pour les sessions du même modèle. Et pas de graisse 600 sur les chiffres en Pixelify (2/5→8).
- Accès mobile : le serveur n'écoutait qu'en loopback. Fix : HOST=0.0.0.0 opt-in avec jeton obligatoire (query → cookie HttpOnly SameSite=Lax ; Strict perd le cookie quand le lien vient d'une autre app).
- Claude Desktop : le binaire claude vit dans un « claude.app » interne (Application Support), détecté à tort comme app hôte. Fix : ignorer le processus lui-même, chercher le .app à partir du parent.
- Nom d'agent instable sur les longues sessions (seule la fin du transcript est lue). Fix : nom = cwd de ~/.claude/sessions/<pid>.json. Une session ouverte sans message n'a pas de transcript : la créer depuis ce fichier.
