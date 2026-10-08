Here’s the Intake decision list:

Audience: Admins.
Problem: Only admins should be able to create, update, or delete students.
V1 boundary: Require admin authentication for create, update, and delete. Keep listing and viewing students unauthenticated, and do not authenticate /health.
Non-goals: Unspecified; you said you don’t know yet.
Risk tier: T2.
Not decided in Intake: Authentication method and how admin accounts are provided.