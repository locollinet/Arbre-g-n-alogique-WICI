# Accès partagé et validation Firestore — Wici

L'application fonctionne sur le principe d'un **lien familial partagé sans authentification** afin que chaque membre de la famille puisse consulter et enrichir l'arbre ainsi que les portraits directement depuis le lien.

- **Portraits (`/personPhotos/{personId}`)** : Lecture, ajout, modification et suppression ouverts aux détenteurs du lien, avec validation stricte du schéma (`personId`, `photoDataUrl` limité à 500 000 caractères, `updatedAt`, et champs optionnels bornés `shape`, `filter`, `caption`, `uploadedBy`).
- **Archive de l'arbre (`/familyArchive/{docId}`)** : Lecture, création et mise à jour ouvertes pour synchroniser en temps réel la liste des membres (`people`, de 1 à 500 entrées) et les réglages (`settings`) sur Firebase. La suppression (`delete`) du document d'archive est interdite (`allow delete: if false;`) pour éviter tout effacement accidentel de l'arbre.
- **Refus par défaut** : Toute autre collection ou chemin dans Firestore est intégralement verrouillé (`allow read, write: if false;`).
