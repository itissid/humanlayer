package filescan

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewScanner_ValidatesAbsolutePaths(t *testing.T) {
	opts := ScanOptions{
		Paths: []string{"relative/path"},
	}
	_, err := NewScanner(opts)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "must be absolute")
}

func TestNewScanner_ValidatesDirectoryExists(t *testing.T) {
	opts := ScanOptions{
		Paths: []string{"/nonexistent/path"},
	}
	_, err := NewScanner(opts)
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "cannot access")
}

func TestScanner_BasicFileDiscovery(t *testing.T) {
	// Setup test directory
	tmpDir := t.TempDir()
	createTestFiles(t, tmpDir, []string{
		"file1.txt",
		"dir1/file2.go",
		"dir1/dir2/file3.md",
	})

	opts := ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: false,
	}
	scanner, err := NewScanner(opts)
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	// Should find 3 files + 2 directories
	assert.Len(t, results, 5)
}

func TestScanner_FilesOnlyOption(t *testing.T) {
	tmpDir := t.TempDir()
	createTestFiles(t, tmpDir, []string{
		"file1.txt",
		"dir1/file2.go",
	})

	opts := ScanOptions{
		Paths:     []string{tmpDir},
		FilesOnly: true,
	}
	scanner, err := NewScanner(opts)
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	// Should find only 2 files, no directories
	assert.Len(t, results, 2)
	for _, r := range results {
		assert.False(t, r.IsDir)
	}
}

func TestScanner_GitignoreFiltering(t *testing.T) {
	tmpDir := t.TempDir()

	// Create .gitignore
	gitignore := filepath.Join(tmpDir, ".gitignore")
	err := os.WriteFile(gitignore, []byte("*.log\nbuild/\n"), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"src/main.go",
		"src/debug.log",
		"build/output.txt",
		"README.md",
	})

	opts := ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
	}
	scanner, err := NewScanner(opts)
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	// Collect basenames
	var names []string
	for _, r := range results {
		names = append(names, filepath.Base(r.AbsPath))
	}

	// Should include main.go and README.md
	assert.Contains(t, names, "main.go")
	assert.Contains(t, names, "README.md")
	// Should exclude debug.log and build/
	assert.NotContains(t, names, "debug.log")
	assert.NotContains(t, names, "build")
}

func TestScanner_ContextCancellation(t *testing.T) {
	tmpDir := t.TempDir()
	// Create many files to ensure scan takes measurable time
	for i := 0; i < 100; i++ {
		err := os.WriteFile(filepath.Join(tmpDir, fmt.Sprintf("file%d.txt", i)), []byte("test"), 0644)
		require.NoError(t, err)
	}

	opts := ScanOptions{Paths: []string{tmpDir}}
	scanner, err := NewScanner(opts)
	require.NoError(t, err)

	// Use a context that's already cancelled
	ctx, cancel := context.WithCancel(context.Background())
	cancel() // Cancel immediately

	_, err = scanner.Scan(ctx)

	// Should return context.Canceled error
	assert.ErrorIs(t, err, context.Canceled)
}

// Helper to create test file structure
func createTestFiles(t *testing.T, root string, paths []string) {
	for _, p := range paths {
		fullPath := filepath.Join(root, p)
		dir := filepath.Dir(fullPath)

		err := os.MkdirAll(dir, 0755)
		require.NoError(t, err)

		err = os.WriteFile(fullPath, []byte("test content"), 0644)
		require.NoError(t, err)
	}
}

// Helper to create .claude/fuzzy-include file
func createFuzzyInclude(t *testing.T, root string, content string) {
	t.Helper()
	err := os.MkdirAll(filepath.Join(root, ".claude"), 0755)
	require.NoError(t, err)
	err = os.WriteFile(filepath.Join(root, ".claude", "fuzzy-include"), []byte(content), 0644)
	require.NoError(t, err)
}

// Helper to collect relative paths from scan results
func relPaths(t *testing.T, root string, results []FileEntry) []string {
	t.Helper()
	var paths []string
	for _, r := range results {
		rel, err := filepath.Rel(root, r.AbsPath)
		require.NoError(t, err)
		paths = append(paths, rel)
	}
	return paths
}

func TestScanner_ForceInclude_Absent(t *testing.T) {
	tmpDir := t.TempDir()

	err := os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("logs/\n"), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"src/main.go",
		"logs/app.log",
	})

	scanner, err := NewScanner(ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
	})
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	paths := relPaths(t, tmpDir, results)
	assert.Contains(t, paths, "src/main.go")
	assert.NotContains(t, paths, "logs/app.log")
	assert.NotContains(t, paths, "logs")
}

func TestScanner_ForceInclude_PathPrefix(t *testing.T) {
	tmpDir := t.TempDir()

	err := os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("logs/\n"), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"src/main.go",
		"logs/app.log",
		"logs/error.log",
	})

	createFuzzyInclude(t, tmpDir, "logs\n")

	scanner, err := NewScanner(ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
	})
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	paths := relPaths(t, tmpDir, results)
	assert.Contains(t, paths, "src/main.go")
	assert.Contains(t, paths, "logs/app.log")
	assert.Contains(t, paths, "logs/error.log")
	assert.Contains(t, paths, "logs")
}

func TestScanner_ForceInclude_NestedPath(t *testing.T) {
	tmpDir := t.TempDir()

	err := os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("thoughts/\n"), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"src/main.go",
		"thoughts/searchable/doc1.md",
		"thoughts/other/doc2.md",
	})

	createFuzzyInclude(t, tmpDir, "thoughts/searchable\n")

	scanner, err := NewScanner(ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
	})
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	paths := relPaths(t, tmpDir, results)
	assert.Contains(t, paths, "thoughts/searchable/doc1.md")
	assert.Contains(t, paths, "thoughts/searchable")
	assert.NotContains(t, paths, "thoughts/other/doc2.md")
	assert.NotContains(t, paths, "thoughts/other")
}

func TestScanner_ForceInclude_GitNodeModulesStillSkipped(t *testing.T) {
	tmpDir := t.TempDir()

	err := os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte(""), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"src/main.go",
		".git/config",
		"node_modules/pkg/index.js",
	})

	createFuzzyInclude(t, tmpDir, ".git\nnode_modules\n")

	scanner, err := NewScanner(ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
	})
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	paths := relPaths(t, tmpDir, results)
	assert.Contains(t, paths, "src/main.go")
	assert.NotContains(t, paths, ".git/config")
	assert.NotContains(t, paths, "node_modules/pkg/index.js")
}

func TestScanner_ForceInclude_LiveReload(t *testing.T) {
	tmpDir := t.TempDir()

	err := os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("logs/\n"), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"src/main.go",
		"logs/app.log",
	})

	opts := ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
	}

	// First scan: no fuzzy-include file
	scanner1, err := NewScanner(opts)
	require.NoError(t, err)
	results1, err := scanner1.Scan(context.Background())
	require.NoError(t, err)
	paths1 := relPaths(t, tmpDir, results1)
	assert.NotContains(t, paths1, "logs/app.log")

	// Create fuzzy-include between scans
	createFuzzyInclude(t, tmpDir, "logs\n")

	// Second scan: same options, new scanner (as the handler does)
	scanner2, err := NewScanner(opts)
	require.NoError(t, err)
	results2, err := scanner2.Scan(context.Background())
	require.NoError(t, err)
	paths2 := relPaths(t, tmpDir, results2)
	assert.Contains(t, paths2, "logs/app.log")
}

func TestScanner_ForceInclude_DepthLimit(t *testing.T) {
	tmpDir := t.TempDir()

	err := os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("deep/\n"), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"src/main.go",
		"deep/level1.txt",
		"deep/sub/level2.txt",
	})

	createFuzzyInclude(t, tmpDir, "deep\n")

	scanner, err := NewScanner(ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
		MaxDepth:         1,
	})
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	paths := relPaths(t, tmpDir, results)
	// MaxDepth 1 means only immediate children of root
	// deep/ is depth 1 but deep/level1.txt is depth 2
	assert.NotContains(t, paths, "deep/level1.txt")
	assert.NotContains(t, paths, "deep/sub/level2.txt")
}

func TestScanner_ForceInclude_CommentsAndBlankLines(t *testing.T) {
	tmpDir := t.TempDir()

	err := os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte("logs/\n"), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"src/main.go",
		"logs/app.log",
	})

	createFuzzyInclude(t, tmpDir, "# This is a comment\n\n  logs/  \n\n# Another comment\n")

	scanner, err := NewScanner(ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
	})
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	paths := relPaths(t, tmpDir, results)
	assert.Contains(t, paths, "logs/app.log")
}

func TestScanner_ForceInclude_NonexistentDir(t *testing.T) {
	tmpDir := t.TempDir()

	err := os.WriteFile(filepath.Join(tmpDir, ".gitignore"), []byte(""), 0644)
	require.NoError(t, err)

	createTestFiles(t, tmpDir, []string{
		"src/main.go",
	})

	createFuzzyInclude(t, tmpDir, "nonexistent_dir\n")

	scanner, err := NewScanner(ScanOptions{
		Paths:            []string{tmpDir},
		RespectGitignore: true,
	})
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	paths := relPaths(t, tmpDir, results)
	assert.Contains(t, paths, "src/main.go")
	// Should not contain any "nonexistent_dir" entries
	for _, p := range paths {
		assert.NotContains(t, p, "nonexistent_dir")
	}
}

func TestScanner_ForceInclude_SymlinkDirect(t *testing.T) {
	workDir := t.TempDir()
	realTarget := t.TempDir()

	// Create real files in the target directory
	createTestFiles(t, realTarget, []string{"file1.txt", "sub/file2.txt"})

	// Create symlink: workDir/linked → realTarget
	err := os.Symlink(realTarget, filepath.Join(workDir, "linked"))
	require.NoError(t, err)

	// Gitignore the symlinked dir
	err = os.WriteFile(filepath.Join(workDir, ".gitignore"), []byte("linked/\n"), 0644)
	require.NoError(t, err)

	// Force-include it
	createFuzzyInclude(t, workDir, "linked\n")

	scanner, err := NewScanner(ScanOptions{
		Paths:            []string{workDir},
		RespectGitignore: true,
	})
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	paths := relPaths(t, workDir, results)
	// Should contain files via symlinked form
	assert.Contains(t, paths, "linked/file1.txt")
	assert.Contains(t, paths, "linked/sub/file2.txt")
	assert.Contains(t, paths, "linked")
	assert.Contains(t, paths, "linked/sub")

	// Verify without fuzzy-include, they don't appear
	err = os.Remove(filepath.Join(workDir, ".claude", "fuzzy-include"))
	require.NoError(t, err)

	scanner2, err := NewScanner(ScanOptions{
		Paths:            []string{workDir},
		RespectGitignore: true,
	})
	require.NoError(t, err)

	results2, err := scanner2.Scan(context.Background())
	require.NoError(t, err)

	paths2 := relPaths(t, workDir, results2)
	assert.NotContains(t, paths2, "linked/file1.txt")
	assert.NotContains(t, paths2, "linked/sub/file2.txt")
}

func TestScanner_ForceInclude_SymlinkIntermediate(t *testing.T) {
	workDir := t.TempDir()
	realTarget := t.TempDir()

	createTestFiles(t, realTarget, []string{"plans/plan1.md", "research/notes.md"})

	// Create docs/ (real dir) with shared (symlink to realTarget)
	err := os.MkdirAll(filepath.Join(workDir, "docs"), 0755)
	require.NoError(t, err)
	err = os.Symlink(realTarget, filepath.Join(workDir, "docs", "shared"))
	require.NoError(t, err)

	err = os.WriteFile(filepath.Join(workDir, ".gitignore"), []byte("docs/\n"), 0644)
	require.NoError(t, err)

	createFuzzyInclude(t, workDir, "docs/shared/plans\n")

	scanner, err := NewScanner(ScanOptions{
		Paths:            []string{workDir},
		RespectGitignore: true,
	})
	require.NoError(t, err)

	results, err := scanner.Scan(context.Background())
	require.NoError(t, err)

	paths := relPaths(t, workDir, results)
	// Should contain plan1.md via the unresolved symlinked path
	assert.Contains(t, paths, "docs/shared/plans/plan1.md")
	assert.Contains(t, paths, "docs/shared/plans")
	// Should NOT contain research (not in force-include scope)
	assert.NotContains(t, paths, "docs/shared/research/notes.md")
}
