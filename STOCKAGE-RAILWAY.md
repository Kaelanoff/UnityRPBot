# Stockage persistant Railway

Le bot sauvegarde toutes ses données dans :

```text
/data
```

Dans Railway :

1. Ajoute un Volume au service du bot.
2. Monte ce volume sur `/data`.
3. Le Start Command doit être `node index.js`.
4. Ne monte pas le volume sur `/app/data`.

Fichiers sauvegardés automatiquement :

- `/data/hierarchie.json`
- `/data/hierarchie-message.json`
- `/data/access.json`
- `/data/ticket-config.json`
- `/data/tickets.json`

Les fichiers du dossier `data` inclus dans ce ZIP servent uniquement de modèles locaux.
Sur Railway, le bot utilise le volume `/data`.
