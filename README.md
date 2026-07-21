# Claude Rate Limit Status Bar

Petite extension VS Code qui affiche tes limites d'usage **Claude** (fenetre glissante de 5 heures et fenetre hebdomadaire de 7 jours) directement dans la status bar, avec une vraie barre de progression coloree.

![apercu](icon.png)

## Ce que ca affiche

```
✳ 5h ▐███▌ 12% 4h52m    7d ▐██████▌ 75% 1d03h
```

- **5h** : usage de la fenetre de 5 heures + temps avant reset
- **7d** : usage de la fenetre de 7 jours + temps avant reset
- Vraie barre de progression via une police embarquee (JetBrains Mono CS)
- Couleur par barre selon le niveau : vert `< 50%`, jaune `< 75%`, orange `< 90%`, rouge `>= 90%`
- Mise a jour automatique toutes les 5 s ; grise si Claude Code est inactif

## Source des donnees

L'extension lit le cache `%TEMP%\cs-rate-cache.json` ecrit par la statusline `cs` de Claude Code. Les valeurs se mettent a jour tant que Claude Code tourne.

## Installation

Depuis le `.vsix` :

```
code --install-extension claude-ratelimit-statusbar-0.1.0.vsix
```

Puis **redemarre VS Code** (une police d'icones est chargee au demarrage).

## Reglages

| Reglage | Defaut | Description |
| --- | --- | --- |
| `claudeRate.refreshSeconds` | `5` | Intervalle de rafraichissement (s) |
| `claudeRate.staleSeconds` | `90` | Age avant grisage (s) |
| `claudeRate.barWidth` | `8` | Largeur de la barre (cellules) |
| `claudeRate.cachePath` | `""` | Chemin du cache (vide = `%TEMP%`) |

## Licence

MIT
