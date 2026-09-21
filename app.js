// ============================================
// 🔥 FIREBASE CONFIGURATION
// ============================================
const firebaseConfig = {
    apiKey: "AIzaSyB88qc7ltNO5mRkUdYmpiegw-whS9wytGE",
    authDomain: "hayaati-firebase.firebaseapp.com",
    databaseURL: "https://hayaati-firebase-default-rtdb.firebaseio.com",
    projectId: "hayaati-firebase",
    storageBucket: "hayaati-firebase.firebasestorage.app",
    messagingSenderId: "135800433092",
    appId: "1:135800433092:web:acdba652001c295689c91",
    measurementId: "G-TTLBV3KVN2"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.database();

// ============================================
// 🔐 AUTHENTICATION
// ============================================

// Sign Up
function signup() {
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const password2 = document.getElementById('signupPassword2').value;

    if (!email || !password || !password2) {
        showAuthError('الرجاء ملء جميع الحقول');
        return;
    }

    if (password !== password2) {
        showAuthError('كلمات المرور غير متطابقة');
        return;
    }

    if (password.length < 6) {
        showAuthError('يجب أن تكون كلمة المرور 6 أحرف على الأقل');
        return;
    }

    auth.createUserWithEmailAndPassword(email, password)
        .then(userCredential => {
            showAuthSuccess('تم إنشاء الحساب بنجاح! جاري تسجيل الدخول...');
            setTimeout(() => {
                loadAppData();
            }, 1500);
        })
        .catch(error => {
            if (error.code === 'auth/email-already-in-use') {
                showAuthError('هذا البريد مسجل بالفعل');
            } else if (error.code === 'auth/invalid-email') {
                showAuthError('البريد الإلكتروني غير صحيح');
            } else {
                showAuthError('خطأ: ' + error.message);
            }
        });
}

// Login
function login() {
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
    
    firebase.auth().signInWithEmailAndPassword(email, password)
        .then(() => {
            document.getElementById('authContainer').style.display = 'none';
            document.getElementById('appContainer').style.display = 'block';
            loadTasks();
        })
        .catch(error => {
            document.getElementById('successMessage').textContent = 'خطأ: ' + error.message;
        });
}

// Logout
function logout() {
    if (confirm('هل تريد تسجيل الخروج؟')) {
        auth.signOut()
            .then(() => {
                document.getElementById('loginSection').classList.add('active');
                document.getElementById('appSection').style.display = 'none';
                document.getElementById('loginForm').style.display = 'block';
                document.getElementById('signupForm').style.display = 'none';
                clearAllInputs();
            })
            .catch(error => console.error('خطأ:', error));
    }
}

// Toggle between login and signup
function toggleAuth() {
    document.getElementById('loginForm').style.display = 
        document.getElementById('loginForm').style.display === 'none' ? 'block' : 'none';
    document.getElementById('signupForm').style.display = 
        document.getElementById('signupForm').style.display === 'none' ? 'block' : 'none';
    document.getElementById('authError').style.display = 'none';
    document.getElementById('authSuccess').style.display = 'none';
}

// Show/Hide error message
function showAuthError(message) {
    const errorDiv = document.getElementById('authError');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
    document.getElementById('authSuccess').style.display = 'none';
}

// Show/Hide success message
function showAuthSuccess(message) {
    const successDiv = document.getElementById('authSuccess');
    successDiv.textContent = message;
    successDiv.style.display = 'block';
    document.getElementById('authError').style.display = 'none';
}

// ============================================
// 🏠 APP DATA MANAGEMENT
// ============================================

let currentUser = null;
let userDataRef = null;

// Check auth state on load
auth.onAuthStateChanged(user => {
    if (user) {
        currentUser = user;
        loadAppData();
    } else {
        currentUser = null;
        document.getElementById('loginSection').classList.add('active');
        document.getElementById('appSection').style.display = 'none';
    }
});

// Load app when user is authenticated
function loadAppData() {
    if (!currentUser) return;

    document.getElementById('loginSection').classList.remove('active');
    document.getElementById('appSection').style.display = 'flex';
    document.getElementById('userEmail').textContent = currentUser.email;

    // Set up database reference for this user
    userDataRef = db.ref('users/' + currentUser.uid);

    // Load all data from Firebase
    loadTasks();
    loadGoals();
    loadHabits();
    loadNotes();
}

// ============================================
// 📋 TASKS
// ============================================

function addTask() {
    const input = document.getElementById('taskInput');
    const taskText = input.value.trim();

    if (!taskText) {
        alert('الرجاء إدخال مهمة');
        return;
    }

    const taskId = Date.now();
    const taskData = {
        id: taskId,
        text: taskText,
        completed: false,
        createdAt: new Date().toISOString()
    };

    // Save to Firebase
    userDataRef.child('tasks/' + taskId).set(taskData)
        .then(() => {
            input.value = '';
            console.log('✅ تم حفظ المهمة');
        })
        .catch(error => alert('خطأ في الحفظ: ' + error.message));
}

function loadTasks() {
    userDataRef.child('tasks').on('value', snapshot => {
        const tasksList = document.getElementById('tasksList');
        tasksList.innerHTML = '';

        if (snapshot.exists()) {
            const tasks = snapshot.val();
            Object.keys(tasks).forEach(taskId => {
                const task = tasks[taskId];
                addTaskToUI(task);
            });
        }
    });
}

function addTaskToUI(task) {
    const tasksList = document.getElementById('tasksList');
    const li = document.createElement('li');
    li.className = 'list-item' + (task.completed ? ' completed' : '');
    li.innerHTML = `
        <span onclick="toggleTask(${task.id})" style="flex: 1; cursor: pointer;">
            ${task.completed ? '✓' : '○'} ${task.text}
        </span>
        <button onclick="deleteTask(${task.id})" class="btn-delete">🗑️</button>
    `;
    tasksList.appendChild(li);
}

function toggleTask(taskId) {
    userDataRef.child('tasks/' + taskId).once('value', snapshot => {
        const task = snapshot.val();
        userDataRef.child('tasks/' + taskId).update({
            completed: !task.completed
        });
    });
}

function deleteTask(taskId) {
    userDataRef.child('tasks/' + taskId).remove();
}

// ============================================
// 🎯 GOALS
// ============================================

function addGoal() {
    const input = document.getElementById('goalInput');
    const goalText = input.value.trim();

    if (!goalText) {
        alert('الرجاء إدخال هدف');
        return;
    }

    const goalId = Date.now();
    const goalData = {
        id: goalId,
        text: goalText,
        progress: 0,
        createdAt: new Date().toISOString()
    };

    userDataRef.child('goals/' + goalId).set(goalData)
        .then(() => {
            input.value = '';
            console.log('✅ تم حفظ الهدف');
        })
        .catch(error => alert('خطأ: ' + error.message));
}

function loadGoals() {
    userDataRef.child('goals').on('value', snapshot => {
        const goalsList = document.getElementById('goalsList');
        goalsList.innerHTML = '';

        if (snapshot.exists()) {
            const goals = snapshot.val();
            Object.keys(goals).forEach(goalId => {
                const goal = goals[goalId];
                addGoalToUI(goal);
            });
        }
    });
}

function addGoalToUI(goal) {
    const goalsList = document.getElementById('goalsList');
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
        <span style="flex: 1;">
            🎯 ${goal.text}
            <div class="progress-bar">
                <div class="progress" style="width: ${goal.progress}%"></div>
            </div>
        </span>
        <button onclick="deleteGoal(${goal.id})" class="btn-delete">🗑️</button>
    `;
    goalsList.appendChild(li);
}

function deleteGoal(goalId) {
    userDataRef.child('goals/' + goalId).remove();
}

// ============================================
// ✅ HABITS
// ============================================

function addHabit() {
    const input = document.getElementById('habitInput');
    const habitText = input.value.trim();

    if (!habitText) {
        alert('الرجاء إدخال عادة');
        return;
    }

    const habitId = Date.now();
    const habitData = {
        id: habitId,
        text: habitText,
        streak: 0,
        createdAt: new Date().toISOString()
    };

    userDataRef.child('habits/' + habitId).set(habitData)
        .then(() => {
            input.value = '';
            console.log('✅ تم حفظ العادة');
        })
        .catch(error => alert('خطأ: ' + error.message));
}

function loadHabits() {
    userDataRef.child('habits').on('value', snapshot => {
        const habitsList = document.getElementById('habitsList');
        habitsList.innerHTML = '';

        if (snapshot.exists()) {
            const habits = snapshot.val();
            Object.keys(habits).forEach(habitId => {
                const habit = habits[habitId];
                addHabitToUI(habit);
            });
        }
    });
}

function addHabitToUI(habit) {
    const habitsList = document.getElementById('habitsList');
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
        <span style="flex: 1;">
            ✅ ${habit.text} <br>
            <small>streak: ${habit.streak} أيام</small>
        </span>
        <button onclick="deleteHabit(${habit.id})" class="btn-delete">🗑️</button>
    `;
    habitsList.appendChild(li);
}

function deleteHabit(habitId) {
    userDataRef.child('habits/' + habitId).remove();
}

// ============================================
// 📝 NOTES
// ============================================

function addNote() {
    const input = document.getElementById('noteInput');
    const noteText = input.value.trim();

    if (!noteText) {
        alert('الرجاء إدخال ملاحظة');
        return;
    }

    const noteId = Date.now();
    const noteData = {
        id: noteId,
        text: noteText,
        createdAt: new Date().toISOString()
    };

    userDataRef.child('notes/' + noteId).set(noteData)
        .then(() => {
            input.value = '';
            console.log('✅ تم حفظ الملاحظة');
        })
        .catch(error => alert('خطأ: ' + error.message));
}

function loadNotes() {
    userDataRef.child('notes').on('value', snapshot => {
        const notesList = document.getElementById('notesList');
        notesList.innerHTML = '';

        if (snapshot.exists()) {
            const notes = snapshot.val();
            Object.keys(notes).forEach(noteId => {
                const note = notes[noteId];
                addNoteToUI(note);
            });
        }
    });
}

function addNoteToUI(note) {
    const notesList = document.getElementById('notesList');
    const li = document.createElement('li');
    li.className = 'list-item';
    li.innerHTML = `
        <span style="flex: 1;">
            📝 ${note.text}
        </span>
        <button onclick="deleteNote(${note.id})" class="btn-delete">🗑️</button>
    `;
    notesList.appendChild(li);
}

function deleteNote(noteId) {
    userDataRef.child('notes/' + noteId).remove();
}

// ============================================
// 🎨 NAVIGATION
// ============================================

function showSection(sectionName) {
    // Hide all sections
    document.querySelectorAll('.section').forEach(section => {
        section.style.display = 'none';
    });

    // Remove active class from all nav links
    document.querySelectorAll('.nav-link').forEach(link => {
        link.classList.remove('active');
    });

    // Show selected section
    const sectionId = sectionName + '-section';
    document.getElementById(sectionId).style.display = 'block';

    // Add active class to clicked link
    event.target.classList.add('active');
}

// ============================================
// 🧹 UTILITIES
// ============================================

function clearAllInputs() {
    document.getElementById('email').value = '';
    document.getElementById('password').value = '';
    document.getElementById('signupEmail').value = '';
    document.getElementById('signupPassword').value = '';
    document.getElementById('signupPassword2').value = '';
    document.getElementById('taskInput').value = '';
    document.getElementById('goalInput').value = '';
    document.getElementById('habitInput').value = '';
    document.getElementById('noteInput').value = '';
}

console.log('✅ Firebase App Initialized!');
