# Contrôle d’accès aux photos — Wici

Les règles `firestore.rules` ne s'appliquent **qu'après déploiement sur la bonne base**. Avant leur déploiement, vérifier les règles actives dans Firebase. La publication de ces règles exige une préparation des comptes : voir README.

- Le document `familyAccess/{uid}` est créé hors application par le propriétaire (console Firebase ou Admin SDK), avec `role` égal à `viewer`, `editor` ou `admin`.
- Les membres peuvent lire les portraits ; seuls `editor` et `admin` peuvent en ajouter, modifier ou supprimer.
- Aucun client ne peut créer/modifier ses propres autorisations. Les documents `familyAccess` ne peuvent pas être listés et un utilisateur ne peut lire que le sien.
- Les règles vérifient les champs, identifiants et la taille des portraits.
- L'arbre et les fiches restent locaux ; ces règles ne rendent pas confidentielles les données figurant dans le code source ou un site public. Un dépôt privé et un hébergement protégé sont nécessaires si la famille souhaite un accès confidentiel.
