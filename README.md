# L’Arbre des Wici

Application React / Vite d'exploration familiale. Les fiches, liens et réglages sont enregistrés dans **le navigateur local**. Les portraits peuvent être enregistrés dans Firestore si la connexion et les droits le permettent. Il n'existe pas encore de synchronisation multi-appareils des fiches ; utiliser la sauvegarde JSON pour les transférer.

## Lancer le projet

AI Studio peut fournir `firebase-applet-config.json`. Sinon, copier `firebase-applet-config.example.json` vers `firebase-applet-config.json` et renseigner la configuration du projet Firebase ainsi que le bon `firestoreDatabaseId`. Ne pas committer le fichier local. Activer la connexion Google et autoriser les domaines nécessaires dans Firebase Auth. Le projet utilise `bun.lock` ; installer avec `bun install --frozen-lockfile`, puis `bun run dev`, `bun run lint` et `bun run build`.

## Partager et exporter

Le bouton « Partager l’arbre » génère une image PNG, une affiche SVG complète, ou ouvre une page d'impression pour choisir « Enregistrer en PDF » dans le navigateur. L'export inclut les co-parents et les portraits en Data URL. Le PDF dépend de la fonction d'impression de l'appareil. La taille et la lisibilité du panorama dépendent du format de page choisi ; vérifier l'aperçu avant impression. Le moteur de placement reste conçu pour une filiation principale : un conjoint sans enfant peut apparaître isolé, et les filiations complexes entre deux personnes déjà présentes ne sont pas toutes reliées visuellement. Vérifier ces cas avant de partager.

## Attention : sécuriser les portraits avant déploiement

Les nouvelles règles Firestore exigent un compte Firebase autorisé : **ne pas les déployer avant de préparer les accès**, sous peine de bloquer les lecteurs existants. Elles ne sont pas déployées automatiquement par un changement Git.

1. Dans Firebase Authentication, obtenir l'UID de chaque compte autorisé après connexion. Prendre l'UID Firebase Auth, pas une adresse e-mail.
2. Dans la bonne base Firestore, créer manuellement via la console `familyAccess/<UID>` avec le champ texte `role` = `viewer` pour consulter ou `editor` pour modifier les portraits. Un document `admin` a les mêmes droits que `editor`. Personne ne peut modifier ces rôles depuis le client.
3. Sauvegarder les règles actives, tester avec l'émulateur et un compte de chaque rôle, puis déployer `firestore.rules` sur la bonne base. Vérifier lecture, écriture, suppression et refus des comptes inconnus.
4. Se connecter dans l'application : les photos devraient apparaître pour les membres et être modifiables uniquement par les éditeurs.

Ces règles ne protègent **que Firestore**. Ce dépôt et le dossier `public` contiennent des informations familiales : les rendre privés et protéger aussi l'hébergement si l'arbre doit rester confidentiel. Changer la visibilité GitHub ne retire pas les éventuelles copies déjà publiques ni les données d'un site public. Avant tout partage, convenir avec la famille de l'utilisation de ses données et portraits.
