# ARVEXA - projet prêt pour le déploiement

Ce dossier regroupe le site complet en version propre pour le déploiement.

## Structure

- api/ : fonctions backend Vercel
- fichiers HTML de la plateforme
- Firebase configuration et règles
- variables secrètes à définir dans Vercel uniquement

## Sécurité

- Ne jamais ajoutter de clés dans les fichiers HTML ou JavaScript publics.
- Ne jamais committer les variables d'environnement.
- Utiliser Vercel > Settings > Environment Variables.

## Variables requises

```env
FIREBASE_ADMIN_CREDENTIALS={...}
FIREBASE_WEB_API_KEY=...
GROQ_API_KEY=...
GROQ_MODEL=openai/gpt-oss-120b
OPENROUTER_API_KEY=...
OPENROUTER_MODEL=openai/gpt-oss-120b
MISTRAL_API_KEY=...
MISTRAL_MODEL=mistral-large-latest
APP_ORIGIN=https://votre-domaine.vercel.app
```
