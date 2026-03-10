
Functional Specification
Task Review Tracking System
(TRTS)
Version 1.0
January 2026

1. Project Overview
1.1 Purpose
A lightweight web-based platform for managing small-scale review and assignment tasks with limited participant slots.
The system supports:
	•	Task creation with fixed participant limit
	•	User self-selection (claiming slots)
	•	Mandatory admin review before credit reward
	•	Recording of external payments with credit deduction
	•	Clear participant instructions via built-in User Guide
1.2 Core Philosophy
	•	Keep development effort low (limited mandays)
	•	Strong admin control over credit awarding
	•	Transparent process with email trail for every important action
	•	No automatic credit granting
	•	No payment gateway, credit redemption, or complex gamification
2. User Roles
Role
Main Responsibilities
Access Level
Participant
Browse tasks, claim slots, submit completion, track credits
Standard user dashboard
Administrator
Create/manage tasks, review submissions, manage credits & payments
Full system control + guide editor
System
Email notifications, slot counting, transaction logging
Automated

3. Functional Modules & Requirements
3.1 Authentication & Profile
The system provides standard authentication with the following features:
	•	Email and password login
	•	Registration fields: Full Name, Email (primary identifier), Contact Number (mobile/WhatsApp preferred)
	•	Profile editable by user (name, contact)
	•	Basic password reset via email
3.2 Task Management (Admin Only)
Task Creation Fields
Field
Required
Type
Example / Note
Task Name
Yes
Short text
"Review Bukit Indah Mall Website"
Target URL
Yes
URL
https://example.com
Maximum Participants
Yes
Integer
6
Credit Reward per Person
Yes
Integer
12
Validity Period
Yes
Date range
13 Jan 2026 - 20 Jan 2026
Customer / Client Name
No
Text
"Fashion Trend Sdn Bhd"
Customer Contact Number
No
Text
"019-765 4321"
Instructions / Remark
No
Multi-line text
Focus on mobile responsiveness, checkout flow

Task Status Lifecycle
Tasks progress through the following states: Draft → Active → Completed / Expired
Payment tracking flags:
	•	Payment Received from Client (Y/N)
	•	Payment Completed to Participants (Y/N)
Task Actions
	•	Create: Automatically sends "New Task" email to all users
	•	Edit: Only allowed before first claim
	•	Archive/Delete: Only if no participants
3.3 Participant Experience
Browse Tasks
	•	Default view: Available (open slots)
	•	Alternative view: All tasks
	•	Card/table shows: Name, Credits, Slots left, Deadline
Task Detail View
	•	Full task information with current participation count
	•	Action buttons based on status and user state
Claim Participation
	•	Button: "Yes, I will do this task"
	•	One slot per user per task
	•	Immediate email confirmation sent
Submit Completion
	•	Button: "I've finished / Mark as Complete"
	•	Optional file/link upload (screenshot, text, Google doc link, etc.)
	•	Status changes to Pending Review
	•	Email notification sent to admin(s)
Personal Views
	•	My Tasks: List of participations with current status
	•	Credit History: All credit movements with date and reason
	•	Current credit balance (prominently displayed)

3.4 Admin Review & Credit Control
This is the critical control point for the system.
Review Interface
	•	Per-task pending list or centralized "Pending Reviews" dashboard
	•	Information per submission: Participant name, Submission time, Uploaded proof (if any), Action buttons
Admin Decision Options
Decision
Status Becomes
Credit Impact
Email to Participant
Approve
Approved
+X credits added
"Your work has been approved - credits awarded"
Reject
Rejected
No change
"Submission not approved" + optional reason
Request Clarification
Pending Review (stays)
No change
"Please provide more information" + admin comment

Credit Award Timing
Credits are awarded immediately upon Approve action. A transaction record is created at the same time.
Payment Recording
After external payment (bank transfer, e-wallet, cash, etc.):
	•	Select participants who have been paid
	•	Mark as Paid
	•	Deduct corresponding credits
	•	Create transaction record (negative credits)
	•	Send email: "Payment processed - credits deducted as record"
When all participants of a task are marked as paid, the system sets the task flag "Payment Completed to Participants" to Yes.
3.5 Email Notification Rules
Event
Recipients
Typical Subject
New task created
All users
New Review Task Available - [Task Name]
Successful slot claim
The user
Your Slot Confirmed - [Task Name]
Participant submits completion
Admin(s)
New Completion Waiting Review - [Task Name]
Completion Approved (+credits)
Participant
Task Approved ✓ Credits Added
Completion Rejected
Participant
Review Submission Not Approved
More information requested
Participant
Action Needed: More Details for [Task Name]
Credits deducted after payment
Participant
Payment Completed - Credits Updated
Task expiring soon (48-24 hrs)
Participants who claimed
Reminder: Your Task [Name] Ends Soon

3.6 Built-in User Guide
Location: Main menu → "How to Use" / "Panduan Pengguna"
Content is editable by admin and should include step-by-step instructions for participants on how to browse tasks, claim slots, submit completions, and track their credits.

— End of Document —


