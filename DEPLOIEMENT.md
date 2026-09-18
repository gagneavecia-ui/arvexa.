# Déploiement ARVEXA School

## 1. Créer le dépôt GitHub

Depuis ce dossier :

```powershell
git init
git add .
git commit -m "Initialiser ARVEXA School"
git branch -M main
git remote add origin https://github.com/UTILISATEUR/NOM-DU-DEPOT.git
git push -u origin main
```

Ne jamais ajouter de clé IA, token Telegram ou fichier `.env` au dépôt.

## 2. Connecter Vercel

Dans Vercel :

1. `Add New Project`
2. Importer le dépôt GitHub
3. Framework Preset : `Other`
4. Build Command : laisser vide
5. Output Directory : `.`
6. Deploy

Le site est statique : aucun serveur Node n'est requis pour l'interface actuelle.

## 3. Publier une mise à jour

```powershell
git add .
git commit -m "Décrire la modification"
git push origin main
```

Vercel déploie automatiquement la branche `main`. Chaque Pull Request reçoit normalement une URL Preview.

## 4. Règles Firebase

Vercel héberge les fichiers, mais Firebase garde les données et les règles :

```powershell
firebase deploy --only firestore:rules --project arvexa-fbf10
```

Ne pas déployer Storage avec le forfait Spark.

## 5. Vérifications après déploiement

- ouvrir `https://DOMAINE/index.html` ;
- vérifier inscription, connexion et déconnexion ;
- vérifier les lectures/écritures Firestore ;
- vérifier que `/firestore.rules` et `/firebase.json` renvoient une erreur 404 ;
- vérifier le Service Worker dans DevTools > Application ;
- vérifier les erreurs Console et Network sur mobile ;
- tester hors connexion après une première visite.

## Architecture IA

Les appels IA doivent passer par une fonction backend ou une API Vercel avec variable d'environnement. Une clé IA ne doit jamais être réintroduite dans un fichier HTML ou JavaScript public.
