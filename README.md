# L’Arbre des Wici

Application React / Vite d'exploration et d'archives familiales pour la famille Wici (5 générations, 5 branches majeures issues de Victoria Tripel).

## Fonctionnalités Clés

- **Synchronisation Cloud Temps Réel (Firebase Firestore)** :
  - **Fiches & Liens (`familyArchive/main`)** : Toutes les modifications de fiches, dates, notes et ajouts d'enfants sont synchronisés automatiquement dans Firestore (avec copie locale instantanée en cache).
  - **Portraits Photographiques (`personPhotos/{personId}`)** : Les photos recadrées et optimisées sont stockées séparément dans Firestore pour garder un chargement ultra-léger.
  - **Zéro Friction (Partage par Lien Direct)** : Toute personne de la famille disposant du lien peut consulter l'arbre, compléter une fiche ou ajouter un portrait sans avoir besoin de créer un compte ou de se connecter.
- **Arbre Interactif Haute Lisibilité (Haut → Bas & Gauche → Droite)** :
  - **Empilement intelligent des fratries terminales** : Réduit de moitié la largeur totale de l'arbre en mode vertical afin que l'arbre entier soit lisible d'un seul coup d'œil.
  - **Surbrillance du chemin de lignée** : Survoler une personne met en lumière tous ses ascendants et descendants directs.
  - **Navigation Fluide (Mobile & Desktop)** : Pincer pour zoomer à 2 doigts sur mobile, molette/trackpad centré sur le curseur, curseur de zoom direct, bouton « Voir en entier » et mode « Vue 3 générations ».
- **Atelier Photo Débloqué** :
  - Normalisation automatique des photos haute résolution avec dézoom libre jusqu'à **15 %**, boutons rapides « Photo entière » / « Remplir » et filtres d'époque optionnels.
- **Export & Impression** :
  - Export de l'affiche complète en PNG, SVG vectoriel ou impression PDF paysage incluant tous les membres, co-parents et portraits.

## Lancer le projet

AI Studio fournit automatiquement `firebase-applet-config.json`. En développement local, vous pouvez copier `firebase-applet-config.example.json` vers `firebase-applet-config.json` avec les identifiants de votre projet Firebase.
