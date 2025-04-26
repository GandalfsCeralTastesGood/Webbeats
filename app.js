import { createApp, ref, computed, onMounted } from 'vue';

createApp({
    setup() {
        // Database connection
        const room = new WebsimSocket();
        
        // Views management
        const currentView = ref('home');
        const currentUser = ref(null);
        
        // Dev mode
        const devMode = ref(false);
        
        // Audio player setup
        const audioPlayer = ref(null);
        const isPlaying = ref(false);
        const currentTime = ref(0);
        const duration = ref(0);
        const volume = ref(65);
        const currentTrack = ref(null);
        const progress = computed(() => {
            return duration.value ? (currentTime.value / duration.value) * 100 : 0;
        });

        // Song collections
        const recentlyUploaded = ref([]);
        const mostPlayed = ref([]);
        const mostLiked = ref([]);
        const recentlyPlayedByYou = ref([]);
        const likedSongs = ref([]);
        const playlists = ref([]);
        const yourLibrary = ref([]);
        
        // Featured songs and news
        const featuredSongs = ref([]);
        const newsItems = ref([]);
        
        // Upload form
        const uploadForm = ref({
            title: '',
            artist: '',
            category: 'Other',
            album: '',
            file: null,
            coverFile: null
        });
        const isUploading = ref(false);
        const songFileError = ref('');
        const coverFileError = ref('');

        // Search functionality
        const searchQuery = ref('');
        const searchResults = ref([]);
        const hasSearched = ref(false);
        const searchFilters = ref({
            sortBy: 'recent',
            uploader: '',
            artist: '',
            category: '',
            songId: ''
        });
        
        // Playlist functionality
        const showCreatePlaylistForm = ref(false);
        const selectedPlaylist = ref(null);
        const playlistSearchQuery = ref('');
        const songSearchInput = ref('');
        const songSearchError = ref('');
        const playlistForm = ref({
            name: '',
            description: '',
            songs: []
        });
        const playlistSongs = ref([]);

        // Edit song functionality
        const showEditSongModal = ref(false);
        const songToEdit = ref(null);
        const isEditing = ref(false);
        const editSongForm = ref({
            title: '',
            artist: '',
            category: 'Other',
            album: '',
            file: null,
            coverFile: null
        });
        const editSongFileError = ref('');
        const editCoverFileError = ref('');

        // Initialize room and load data
        onMounted(async () => {
            await room.initialize();
            
            // Get current user
            try {
                const user = await window.websim.getUser();
                currentUser.value = user;
                
                // Fix duplicate likes after user is loaded
                await fixDuplicateLikes();
                
                // Update all songs like counts after fixing duplicates
                await updateAllSongLikeCounts();
            } catch (error) {
                console.error('Error getting user:', error);
            }
            
            // Fetch featured songs explicitly on load
            fetchFeaturedSongs();
            
            // Fetch news
            fetchNewsItems();

            // Subscribe to changes
            room.collection('song').subscribe((songs) => {
                updateSongCollections(songs);
            });
            
            room.collection('like').subscribe((likes) => {
                updateLikedSongs(likes);
            });
            
            room.collection('playlist').subscribe((playlists) => {
                updatePlaylists(playlists);
            });
            
            // Set up audio player
            if (audioPlayer.value) {
                audioPlayer.value.volume = volume.value / 100;
            }
            
            // Dev mode keyboard shortcut
            window.addEventListener('keydown', (e) => {
                if (e.ctrlKey && e.key === '.') {
                    devMode.value = !devMode.value;
                }
            });
        });

        // Update song collections
        const updateSongCollections = (songs) => {
            if (!songs || !songs.length) return;
            
            // Fetch featured songs first
            fetchFeaturedSongs();
            
            // Sort by created_at (newest first)
            const sortedByDate = [...songs].sort((a, b) => 
                new Date(b.created_at) - new Date(a.created_at)
            );
            
            // Sort by plays (most first)
            const sortedByPlays = [...songs].sort((a, b) => 
                (b.plays || 0) - (a.plays || 0)
            );
            
            // Sort by likes (most first)
            const sortedByLikes = [...songs].sort((a, b) => 
                (b.likes || 0) - (a.likes || 0)
            );
            
            // Recently uploaded - newest 5
            recentlyUploaded.value = sortedByDate.slice(0, 5);
            
            // Most played - top 5
            mostPlayed.value = sortedByPlays.slice(0, 5);
            
            // Most liked - top 5
            mostLiked.value = sortedByLikes.slice(0, 5);
            
            // Filter uploaded songs by current user
            if (currentUser.value) {
                const username = currentUser.value.username;
                const userUploads = songs.filter(song => song.username === username);
                yourLibrary.value = userUploads;
            }
            
            // Filter recently played by current user
            if (currentUser.value) {
                const username = currentUser.value.username;
                const userPlays = room.collection('play')
                    .filter({ username: username })
                    .getList();
                
                if (userPlays && userPlays.length) {
                    // Sort by most recent plays
                    const sortedPlays = [...userPlays].sort((a, b) => 
                        new Date(b.created_at) - new Date(a.created_at)
                    );
                    
                    // Get unique songs from plays
                    const uniqueSongIds = [...new Set(sortedPlays.map(play => play.song_id))];
                    
                    // Map song IDs to full song objects
                    recentlyPlayedByYou.value = uniqueSongIds
                        .map(id => songs.find(song => song.id === id))
                        .filter(Boolean)
                        .slice(0, 5);
                }
            }
            
            // Update search results if search is active
            if (hasSearched.value) {
                performSearch();
            }
            
            // Update playlist songs if a playlist is selected
            if (selectedPlaylist.value && selectedPlaylist.value.songs) {
                updatePlaylistSongs();
            }
        };

        // Fetch featured songs
        const fetchFeaturedSongs = async () => {
            try {
                const response = await fetch('https://brickarcadium.serv00.net/WebBeats/featured.json');
                if (!response.ok) {
                    throw new Error('Failed to fetch featured songs');
                }
                
                const featuredData = await response.json();
                if (!featuredData) return;
                
                // Extract song IDs from the object (values only)
                const featuredIds = Object.values(featuredData);
                
                const songs = room.collection('song').getList() || [];
                
                // Map IDs to song objects
                featuredSongs.value = featuredIds
                    .map(id => songs.find(song => song.id === id))
                    .filter(Boolean) // Remove any undefined values
                    .slice(0, 5); // Limit to 5 songs
            } catch (error) {
                console.error('Error fetching featured songs:', error);
            }
        };

        // Fetch news items
        const fetchNewsItems = async () => {
            try {
                const response = await fetch('https://brickarcadium.serv00.net/WebBeats/news.json');
                if (!response.ok) {
                    throw new Error('Failed to fetch news');
                }
                
                const news = await response.json();
                newsItems.value = Array.isArray(news) ? news : [news];
            } catch (error) {
                console.error('Error fetching news:', error);
            }
        };

        // Update liked songs
        const updateLikedSongs = (likes) => {
            if (!likes || !currentUser.value) return;
            
            // Get unique song IDs from likes by current user
            const uniqueSongIds = [...new Set(
                likes
                    .filter(like => like.username === currentUser.value.username)
                    .map(like => like.song_id)
            )];
            
            // Get songs from likes
            const songs = room.collection('song').getList();
            likedSongs.value = uniqueSongIds.map(songId => 
                songs.find(song => song.id === songId)
            ).filter(Boolean);
        };

        // Check if a song is liked by current user
        const isLiked = (songId) => {
            if (!currentUser.value) return false;
            
            const likes = room.collection('like').getList();
            return likes.some(like => 
                like.song_id === songId && 
                like.username === currentUser.value.username
            );
        };

        // Toggle like status for a song
        const toggleLike = async (song) => {
            if (!currentUser.value || !song) return;
            
            const likes = room.collection('like').getList();
            
            // Find all likes by this user for this song
            const userSongLikes = likes.filter(like => 
                like.song_id === song.id && 
                like.username === currentUser.value.username
            );
            
            if (userSongLikes.length > 0) {
                // Unlike: delete all likes from this user on this song
                for (const like of userSongLikes) {
                    await room.collection('like').delete(like.id);
                }
                
                // Update song's like count
                await updateSongLikeCount(song.id);
            } else {
                // Check if the user already liked this song
                if (userSongLikes.length === 0) {
                    // Like: create a new like record
                    await room.collection('like').create({
                        song_id: song.id,
                        username: currentUser.value.username
                    });
                    
                    // Update song's like count
                    await updateSongLikeCount(song.id);
                }
            }
        };

        // Fix duplicate likes in the database
        const fixDuplicateLikes = async () => {
            if (!currentUser.value) return;
            
            const likes = room.collection('like').getList();
            const songs = room.collection('song').getList();
            
            // Create a map to track unique song/user combinations
            const uniqueLikesMap = {};
            const songsToUpdate = new Set();
            
            // Identify duplicate likes
            for (const like of likes) {
                const key = `${like.song_id}_${like.username}`;
                
                if (!uniqueLikesMap[key]) {
                    uniqueLikesMap[key] = [like];
                } else {
                    uniqueLikesMap[key].push(like);
                    songsToUpdate.add(like.song_id);
                }
            }
            
            console.log(`Analyzing likes for ${Object.keys(uniqueLikesMap).length} unique song/user combinations`);
            
            // For each song/user combination with duplicates, keep only one like
            let deletedCount = 0;
            for (const key in uniqueLikesMap) {
                const likeGroup = uniqueLikesMap[key];
                if (likeGroup.length > 1) {
                    console.log(`Found ${likeGroup.length} duplicate likes for ${key}`);
                    
                    // Keep the first like, delete the rest
                    for (let i = 1; i < likeGroup.length; i++) {
                        await room.collection('like').delete(likeGroup[i].id);
                        deletedCount++;
                    }
                }
            }
            
            if (deletedCount > 0) {
                console.log(`Deleted ${deletedCount} duplicate likes`);
            } else {
                console.log('No duplicate likes found');
            }
            
            console.log('Like count cleanup completed');
        };

        // Update like counts for all songs
        const updateAllSongLikeCounts = async () => {
            const songs = room.collection('song').getList();
            const likes = room.collection('like').getList();
            
            // Track unique song/user combinations
            const uniqueLikeCounts = {};
            
            // Count unique likes per song
            for (const like of likes) {
                if (!like.song_id) continue;
                
                const key = `${like.song_id}_${like.username}`;
                
                if (!uniqueLikeCounts[like.song_id]) {
                    uniqueLikeCounts[like.song_id] = new Set();
                }
                
                uniqueLikeCounts[like.song_id].add(key);
            }
            
            // Update like count for each song
            for (const song of songs) {
                const likeCount = uniqueLikeCounts[song.id] ? uniqueLikeCounts[song.id].size : 0;
                
                // Only update if the count differs from current value
                if (song.likes !== likeCount) {
                    console.log(`Updating song ${song.id} like count from ${song.likes} to ${likeCount}`);
                    await room.collection('song').update(song.id, {
                        likes: likeCount
                    });
                }
            }
            
            console.log('All song like counts updated');
        };

        // Update the like count for a specific song
        const updateSongLikeCount = async (songId) => {
            const likes = room.collection('like').getList();
            
            // Get unique usernames who liked this song
            const uniqueUsernames = [...new Set(
                likes
                    .filter(like => like.song_id === songId)
                    .map(like => like.username)
            )];
            
            const likeCount = uniqueUsernames.length;
            
            // Update the song's like count
            await room.collection('song').update(songId, {
                likes: likeCount
            });
            
            console.log(`Updated like count for song ${songId} to ${likeCount}`);
        };

        // Search songs
        const performSearch = () => {
            hasSearched.value = true;
            
            let results = room.collection('song').getList() || [];
            
            // Search by ID if provided
            if (searchFilters.value.songId.trim()) {
                const songId = searchFilters.value.songId.trim();
                results = results.filter(song => 
                    song.id.includes(songId)
                );
                searchResults.value = results.slice(0, 50); // Limit to 50 results
                return;
            }
            
            // Apply text search if query exists
            if (searchQuery.value.trim()) {
                const query = searchQuery.value.toLowerCase();
                results = results.filter(song => 
                    song.title.toLowerCase().includes(query) || 
                    song.artist.toLowerCase().includes(query) || 
                    (song.username && song.username.toLowerCase().includes(query))
                );
            }
            
            // Apply filters
            if (searchFilters.value.uploader) {
                const uploader = searchFilters.value.uploader.toLowerCase();
                results = results.filter(song => 
                    song.username && song.username.toLowerCase().includes(uploader)
                );
            }
            
            if (searchFilters.value.artist) {
                const artist = searchFilters.value.artist.toLowerCase();
                results = results.filter(song => 
                    song.artist.toLowerCase().includes(artist)
                );
            }
            
            if (searchFilters.value.category) {
                results = results.filter(song => 
                    song.category === searchFilters.value.category
                );
            }
            
            // Sort results
            switch (searchFilters.value.sortBy) {
                case 'recent':
                    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    break;
                case 'plays':
                    results.sort((a, b) => (b.plays || 0) - (a.plays || 0));
                    break;
                case 'likes':
                    results.sort((a, b) => (b.likes || 0) - (a.likes || 0));
                    break;
            }
            
            searchResults.value = results.slice(0, 50);
        };

        // Format time (mm:ss)
        const formatTime = (seconds) => {
            if (!seconds || isNaN(seconds)) return '0:00';
            const mins = Math.floor(seconds / 60);
            const secs = Math.floor(seconds % 60);
            return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
        };

        // Play a song
        const playSong = async (song) => {
            if (!song || !song.fileUrl) return;
            
            currentTrack.value = song;
            
            // Clean up duplicate likes for this song
            await cleanupDuplicateLikesForSong(song.id);
            
            if (audioPlayer.value) {
                audioPlayer.value.src = song.fileUrl;
                audioPlayer.value.play().then(() => {
                    isPlaying.value = true;
                    
                    // Record play
                    if (currentUser.value) {
                        recordPlay(song.id);
                    }
                    
                    // Update plays count in song record
                    updateSongPlays(song);
                }).catch(e => {
                    console.error('Error playing song:', e);
                });
            }
        };
        
        // Clean up duplicate likes for a specific song
        const cleanupDuplicateLikesForSong = async (songId) => {
            if (!songId) return;
            
            const likes = room.collection('like').getList();
            
            // Group likes by username
            const likesByUser = {};
            
            // Find all likes for this song
            const songLikes = likes.filter(like => like.song_id === songId);
            
            // Sort by created_at to keep the oldest like
            songLikes.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
            
            for (const like of songLikes) {
                if (!like.username) continue;
                
                if (!likesByUser[like.username]) {
                    likesByUser[like.username] = [like];
                } else {
                    likesByUser[like.username].push(like);
                }
            }
            
            // Clean up duplicate likes
            let cleaned = false;
            for (const username in likesByUser) {
                const userLikes = likesByUser[username];
                if (userLikes.length > 1) {
                    console.log(`Found ${userLikes.length} duplicate likes for song ${songId} by ${username}`);
                    
                    // Keep the first like, delete the rest
                    for (let i = 1; i < userLikes.length; i++) {
                        await room.collection('like').delete(userLikes[i].id);
                        cleaned = true;
                    }
                }
            }
            
            // Update like count if we cleaned any duplicates
            if (cleaned) {
                await updateSongLikeCount(songId);
            }
        };

        // Record play in database
        const recordPlay = async (songId) => {
            if (!currentUser.value || !songId) return;
            
            try {
                await room.collection('play').create({
                    song_id: songId,
                    username: currentUser.value.username
                });
            } catch (error) {
                console.error('Error recording play:', error);
            }
        };
        
        // Update song plays count
        const updateSongPlays = async (song) => {
            if (!song || !song.id) return;
            
            try {
                const currentPlays = song.plays || 0;
                await room.collection('song').update(song.id, {
                    plays: currentPlays + 1
                });
            } catch (error) {
                console.error('Error updating song plays:', error);
            }
        };

        // Toggle play/pause
        const togglePlayPause = () => {
            if (!audioPlayer.value || !currentTrack.value) return;
            
            if (isPlaying.value) {
                audioPlayer.value.pause();
            } else {
                audioPlayer.value.play();
            }
            
            isPlaying.value = !isPlaying.value;
        };

        // Update progress as song plays
        const updateProgress = () => {
            if (!audioPlayer.value) return;
            currentTime.value = audioPlayer.value.currentTime;
        };

        // Set duration when metadata is loaded
        const setDuration = () => {
            if (!audioPlayer.value) return;
            duration.value = audioPlayer.value.duration;
        };

        // Handle song ending
        const songEnded = () => {
            isPlaying.value = false;
            currentTime.value = 0;
            // Could add auto-play next song functionality here
        };

        // Seek track
        const seekTrack = (event) => {
            if (!audioPlayer.value || !duration.value) return;
            
            const progressContainer = event.currentTarget;
            const clickPosition = event.clientX - progressContainer.getBoundingClientRect().left;
            const progressWidth = progressContainer.clientWidth;
            const percentage = clickPosition / progressWidth;
            
            audioPlayer.value.currentTime = duration.value * percentage;
            currentTime.value = audioPlayer.value.currentTime;
        };

        // Change volume
        const changeVolume = (event) => {
            if (!audioPlayer.value) return;
            
            const volumeBar = event.currentTarget;
            const clickPosition = event.clientX - volumeBar.getBoundingClientRect().left;
            const volumeWidth = volumeBar.clientWidth;
            const percentage = (clickPosition / volumeWidth) * 100;
            
            volume.value = Math.min(100, Math.max(0, Math.floor(percentage)));
            audioPlayer.value.volume = volume.value / 100;
        };

        // Handle song file change
        const handleSongFileChange = (event) => {
            songFileError.value = '';
            const file = event.target.files[0];
            
            if (!file) return;
            
            // Validate file type
            const validTypes = ['audio/mpeg', 'audio/ogg'];
            if (!validTypes.includes(file.type)) {
                songFileError.value = 'Please upload an MP3 or OGG file.';
                event.target.value = '';
                return;
            }
            
            // Create audio element to check duration
            const audio = new Audio();
            audio.src = URL.createObjectURL(file);
            
            audio.onloadedmetadata = () => {
                // Check if song is under 10 minutes
                if (audio.duration > 600) { // 600 seconds = 10 minutes
                    songFileError.value = 'Song must be under 10 minutes.';
                    event.target.value = '';
                    return;
                }
                
                uploadForm.value.file = file;
            };
        };

        // Handle cover file change
        const handleCoverFileChange = (event) => {
            coverFileError.value = '';
            const file = event.target.files[0];
            
            if (!file) return;
            
            // Validate file type
            if (!file.type.startsWith('image/')) {
                coverFileError.value = 'Please upload a valid image file.';
                event.target.value = '';
                return;
            }
            
            uploadForm.value.coverFile = file;
        };

        // Upload song
        const uploadSong = async () => {
            if (!uploadForm.value.file || !uploadForm.value.title || !uploadForm.value.artist) {
                return;
            }
            
            isUploading.value = true;
            
            try {
                // Upload song file
                const songUrl = await window.websim.upload(uploadForm.value.file);
                
                // Upload cover file if provided
                let coverUrl = null;
                if (uploadForm.value.coverFile) {
                    coverUrl = await window.websim.upload(uploadForm.value.coverFile);
                }
                
                // Create song record in database
                await room.collection('song').create({
                    title: uploadForm.value.title,
                    artist: uploadForm.value.artist,
                    category: uploadForm.value.category || 'Other',
                    album: uploadForm.value.album || '',
                    fileUrl: songUrl,
                    coverUrl: coverUrl,
                    plays: 0,
                    likes: 0,
                    username: currentUser.value ? currentUser.value.username : null
                });
                
                // Reset form
                uploadForm.value = {
                    title: '',
                    artist: '',
                    category: 'Other',
                    album: '',
                    file: null,
                    coverFile: null
                };
                
                // Reset file inputs
                document.getElementById('song-file').value = '';
                document.getElementById('song-cover').value = '';
                
                // Switch to home view to show the new song
                currentView.value = 'home';
                
            } catch (error) {
                console.error('Error uploading song:', error);
                alert('Error uploading song. Please try again.');
            } finally {
                isUploading.value = false;
            }
        };

        // Load playlist
        const loadPlaylist = (playlist) => {
            console.log('Loading playlist:', playlist.name);
            // Implementation pending
        };

        // Copy song ID to clipboard
        const copySongId = (id) => {
            navigator.clipboard.writeText(id).then(() => {
                alert('Song ID copied to clipboard!');
            }).catch(err => {
                console.error('Could not copy text: ', err);
            });
        };

        // Download song
        const downloadSong = async (song) => {
            if (!song || !song.fileUrl) {
                alert('No song file available to download');
                return;
            }

            try {
                // Fetch the file
                const response = await fetch(song.fileUrl);
                if (!response.ok) {
                    throw new Error('Failed to download file');
                }

                const blob = await response.blob();
                
                // Determine file extension and type
                let extension = 'mp3';
                let fileType = 'audio/mpeg';
                
                // Try to get extension from URL
                const urlParts = song.fileUrl.split('.');
                if (urlParts.length > 1) {
                    const urlExt = urlParts[urlParts.length - 1].toLowerCase();
                    if (['mp3', 'ogg', 'wav', 'mpga', 'mpeg'].includes(urlExt)) {
                        extension = urlExt === 'mpga' || urlExt === 'mpeg' ? 'mp3' : urlExt;
                    }
                }
                
                // Create file name
                const fileName = `${song.artist} - ${song.title}.${extension}`;
                
                // Create download link
                const url = window.URL.createObjectURL(new Blob([blob], { type: fileType }));
                const link = document.createElement('a');
                link.href = url;
                link.setAttribute('download', fileName);
                document.body.appendChild(link);
                link.click();
                
                // Clean up
                window.URL.revokeObjectURL(url);
                document.body.removeChild(link);
            } catch (error) {
                console.error('Error downloading song:', error);
                alert('Error downloading song. Please try again.');
            }
        };

        // Playlist functions
        const updatePlaylists = (playlists) => {
            // This function is now intentionally left empty as we're using the computed filteredPlaylists property
        };

        const filteredPlaylists = computed(() => {
            const playlists = room.collection('playlist').getList() || [];
            
            if (!playlistSearchQuery.value.trim()) {
                return playlists;
            }
            
            const query = playlistSearchQuery.value.toLowerCase();
            return playlists.filter(playlist => 
                playlist.name.toLowerCase().includes(query) ||
                (playlist.description && playlist.description.toLowerCase().includes(query)) ||
                (playlist.username && playlist.username.toLowerCase().includes(query))
            );
        });

        const openCreatePlaylistModal = () => {
            playlistForm.value = {
                name: '',
                description: '',
                songs: []
            };
            showCreatePlaylistForm.value = true;
            selectedPlaylist.value = null;
        };

        const cancelCreatePlaylist = () => {
            showCreatePlaylistForm.value = false;
            songSearchInput.value = '';
            songSearchError.value = '';
        };

        const addSongToPlaylist = () => {
            const input = songSearchInput.value.trim();
            if (!input) {
                songSearchError.value = 'Please enter a song name or ID';
                return;
            }
            
            songSearchError.value = '';
            const songs = room.collection('song').getList() || [];
            
            let songToAdd = null;
            
            // Check if input is an ID
            songToAdd = songs.find(song => song.id === input);
            
            // If not found by ID, search by name
            if (!songToAdd) {
                songToAdd = songs.find(song => 
                    song.title.toLowerCase().includes(input.toLowerCase())
                );
            }
            
            if (!songToAdd) {
                songSearchError.value = 'Song not found';
                return;
            }
            
            // Check if song is already in playlist
            if (playlistForm.value.songs.some(song => song.id === songToAdd.id)) {
                songSearchError.value = 'Song already in playlist';
                return;
            }
            
            // Add song to playlist
            playlistForm.value.songs.push(songToAdd);
            songSearchInput.value = '';
        };

        const removeSongFromPlaylist = (index) => {
            playlistForm.value.songs.splice(index, 1);
        };

        const savePlaylist = async () => {
            if (!playlistForm.value.name || !currentUser.value) return;
            
            try {
                const songIds = playlistForm.value.songs.map(song => song.id);
                
                await room.collection('playlist').create({
                    name: playlistForm.value.name,
                    description: playlistForm.value.description || '',
                    username: currentUser.value.username,
                    songs: songIds,
                    created_at: new Date().toISOString()
                });
                
                showCreatePlaylistForm.value = false;
                alert('Playlist created successfully!');
                
            } catch (error) {
                console.error('Error creating playlist:', error);
                alert('Error creating playlist. Please try again.');
            }
        };

        const searchPlaylists = () => {
            // Automatically handled by the computed property
        };

        const viewPlaylist = (playlist) => {
            selectedPlaylist.value = playlist;
            showCreatePlaylistForm.value = false;
            updatePlaylistSongs();
        };

        const closePlaylist = () => {
            selectedPlaylist.value = null;
        };

        const updatePlaylistSongs = () => {
            if (!selectedPlaylist.value || !selectedPlaylist.value.songs) {
                playlistSongs.value = [];
                return;
            }
            
            const allSongs = room.collection('song').getList() || [];
            playlistSongs.value = selectedPlaylist.value.songs
                .map(songId => allSongs.find(song => song.id === songId))
                .filter(Boolean); // Filter out any undefined values
        };

        const getPlaylistCover = (playlist) => {
            // Use the first song's cover as the playlist cover
            if (!playlist.songs || playlist.songs.length === 0) {
                return '/2025_04_19_0zc_Kleki.png';
            }
            
            const allSongs = room.collection('song').getList() || [];
            const firstSong = allSongs.find(song => song.id === playlist.songs[0]);
            
            return firstSong && firstSong.coverUrl 
                ? firstSong.coverUrl 
                : '/2025_04_19_0zc_Kleki.png';
        };

        // Open edit song modal
        const openEditSongModal = (song) => {
            if (!song || !currentUser.value) return;
            
            // Verify song belongs to current user
            if (song.username !== currentUser.value.username) {
                alert('You can only edit your own songs.');
                return;
            }
            
            songToEdit.value = song;
            
            // Initialize form with song data
            editSongForm.value = {
                title: song.title,
                artist: song.artist,
                category: song.category || 'Other',
                album: song.album || '',
                file: null,
                coverFile: null
            };
            
            editSongFileError.value = '';
            editCoverFileError.value = '';
            showEditSongModal.value = true;
        };

        // Close edit song modal
        const closeEditSongModal = () => {
            showEditSongModal.value = false;
            songToEdit.value = null;
        };

        // Handle edit song file change
        const handleEditSongFileChange = (event) => {
            editSongFileError.value = '';
            const file = event.target.files[0];
            
            if (!file) return;
            
            // Validate file type
            const validTypes = ['audio/mpeg', 'audio/ogg'];
            if (!validTypes.includes(file.type)) {
                editSongFileError.value = 'Please upload an MP3 or OGG file.';
                event.target.value = '';
                return;
            }
            
            // Create audio element to check duration
            const audio = new Audio();
            audio.src = URL.createObjectURL(file);
            
            audio.onloadedmetadata = () => {
                // Check if song is under 10 minutes
                if (audio.duration > 600) { // 600 seconds = 10 minutes
                    editSongFileError.value = 'Song must be under 10 minutes.';
                    event.target.value = '';
                    return;
                }
                
                editSongForm.value.file = file;
            };
        };

        // Handle edit cover file change
        const handleEditCoverFileChange = (event) => {
            editCoverFileError.value = '';
            const file = event.target.files[0];
            
            if (!file) return;
            
            // Validate file type
            if (!file.type.startsWith('image/')) {
                editCoverFileError.value = 'Please upload a valid image file.';
                event.target.value = '';
                return;
            }
            
            editSongForm.value.coverFile = file;
        };

        // Update song
        const updateSong = async () => {
            if (!songToEdit.value || !currentUser.value) return;
            
            // Verify song belongs to current user
            if (songToEdit.value.username !== currentUser.value.username) {
                alert('You can only edit your own songs.');
                return;
            }
            
            if (!editSongForm.value.title || !editSongForm.value.artist) {
                alert('Title and artist are required');
                return;
            }
            
            isEditing.value = true;
            
            try {
                const updateData = {
                    title: editSongForm.value.title,
                    artist: editSongForm.value.artist,
                    category: editSongForm.value.category || 'Other',
                    album: editSongForm.value.album || ''
                };
                
                // Upload new song file if provided
                if (editSongForm.value.file) {
                    const songUrl = await window.websim.upload(editSongForm.value.file);
                    updateData.fileUrl = songUrl;
                }
                
                // Upload new cover file if provided
                if (editSongForm.value.coverFile) {
                    const coverUrl = await window.websim.upload(editSongForm.value.coverFile);
                    updateData.coverUrl = coverUrl;
                }
                
                // Update song record in database
                await room.collection('song').update(songToEdit.value.id, updateData);
                
                // Close modal
                closeEditSongModal();
                
                // Show success message
                alert('Song updated successfully!');
                
                // If the current track is the one we just edited, update it
                if (currentTrack.value && currentTrack.value.id === songToEdit.value.id) {
                    const songs = room.collection('song').getList();
                    const updatedSong = songs.find(s => s.id === songToEdit.value.id);
                    if (updatedSong) {
                        currentTrack.value = updatedSong;
                    }
                }
                
            } catch (error) {
                console.error('Error updating song:', error);
            } finally {
                isEditing.value = false;
            }
        };

        // Delete song
        const deleteSong = async (song) => {
            if (!currentUser.value || !song) return;
            
            // Verify song belongs to current user
            if (song.username !== currentUser.value.username) {
                alert('You can only delete your own songs.');
                return;
            }
            
            if (confirm('Are you sure you want to delete this song? This action cannot be undone.')) {
                try {
                    await room.collection('song').delete(song.id);
                    
                    // If the current track is the one we just deleted, clear it
                    if (currentTrack.value && currentTrack.value.id === song.id) {
                        if (audioPlayer.value) {
                            audioPlayer.value.pause();
                            isPlaying.value = false;
                        }
                        currentTrack.value = null;
                    }
                    
                    alert('Song deleted successfully!');
                } catch (error) {
                    console.error('Error deleting song:', error);
                    alert('Error deleting song. Please try again.');
                }
            }
        };

        return {
            // References
            audioPlayer,
            
            // State
            currentView,
            currentUser,
            isPlaying,
            currentTime,
            duration,
            volume,
            currentTrack,
            playlists,
            recentlyUploaded,
            mostPlayed,
            mostLiked,
            recentlyPlayedByYou,
            likedSongs,
            yourLibrary,
            devMode,
            featuredSongs,
            newsItems,
            progress,
            
            // Upload
            uploadForm,
            isUploading,
            songFileError,
            coverFileError,
            
            // Search and likes
            searchQuery,
            searchFilters,
            searchResults,
            hasSearched,
            
            // Playlist
            showCreatePlaylistForm,
            selectedPlaylist,
            playlistSearchQuery,
            songSearchInput,
            songSearchError,
            playlistForm,
            playlistSongs,
            filteredPlaylists,
            
            // Edit song
            showEditSongModal,
            editSongForm,
            isEditing,
            editSongFileError,
            editCoverFileError,
            
            // Methods
            formatTime,
            playSong,
            togglePlayPause,
            updateProgress,
            setDuration,
            songEnded,
            seekTrack,
            changeVolume,
            handleSongFileChange,
            handleCoverFileChange,
            uploadSong,
            loadPlaylist,
            performSearch,
            toggleLike,
            isLiked,
            copySongId,
            downloadSong,
            openCreatePlaylistModal,
            cancelCreatePlaylist,
            addSongToPlaylist,
            removeSongFromPlaylist,
            savePlaylist,
            searchPlaylists,
            viewPlaylist,
            closePlaylist,
            getPlaylistCover,
            openEditSongModal,
            closeEditSongModal,
            handleEditSongFileChange,
            handleEditCoverFileChange,
            updateSong,
            fetchFeaturedSongs,
            fetchNewsItems,
            deleteSong
        };
    }
}).mount('#app');
