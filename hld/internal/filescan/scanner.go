package filescan

import (
	"context"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"

	ignore "github.com/sabhiram/go-gitignore"
)

// ScanOptions configures file system scanning behavior
type ScanOptions struct {
	// Paths to scan (must be absolute directories)
	Paths []string
	// FilesOnly excludes directories from results
	FilesOnly bool
	// RespectGitignore filters out gitignored paths
	RespectGitignore bool
	// MaxDepth limits recursion depth (-1 for unlimited, 1 for immediate children only)
	MaxDepth int
}

// FileEntry represents a discovered file or directory
type FileEntry struct {
	// AbsPath is the absolute path to the file/folder
	AbsPath string
	// IsDir indicates if this is a directory
	IsDir bool
}

// Scanner performs file system traversal with filtering
type Scanner struct {
	options   ScanOptions
	gitignore *ignore.GitIgnore
}

// NewScanner creates a Scanner with the given options
func NewScanner(opts ScanOptions) (*Scanner, error) {
	if err := validatePaths(opts.Paths); err != nil {
		return nil, fmt.Errorf("invalid paths: %w", err)
	}

	s := &Scanner{options: opts}

	if opts.RespectGitignore {
		// Load .gitignore from first path's root
		// For simplicity, only check root .gitignore initially
		gitignorePath := filepath.Join(opts.Paths[0], ".gitignore")
		if gi, err := loadGitignore(gitignorePath); err == nil {
			s.gitignore = gi
		}
		// Silently ignore missing .gitignore
	}

	return s, nil
}

// Scan performs the file system traversal
// Returns accumulated results and any error encountered
func (s *Scanner) Scan(ctx context.Context) ([]FileEntry, error) {
	var results []FileEntry
	seen := make(map[string]bool) // Deduplication across multiple paths

	for _, rootPath := range s.options.Paths {
		select {
		case <-ctx.Done():
			return results, ctx.Err()
		default:
		}

		err := filepath.WalkDir(rootPath, func(path string, d fs.DirEntry, err error) error {
			// Check context cancellation
			select {
			case <-ctx.Done():
				return ctx.Err()
			default:
			}

			// Handle walk errors
			if err != nil {
				// Skip permission denied and other errors silently
				return nil
			}

			// Get absolute path
			absPath, err := filepath.Abs(path)
			if err != nil {
				return nil
			}

			// Skip if already seen (handles overlapping paths)
			if seen[absPath] {
				return nil
			}

			// Skip root path itself
			if absPath == rootPath {
				return nil
			}

			// Calculate depth relative to root
			relPath, err := filepath.Rel(rootPath, absPath)
			if err != nil {
				return nil
			}
			depth := len(filepath.SplitList(relPath))
			if filepath.Separator == '/' {
				// On Unix, count separators in the relative path
				depth = 0
				for _, c := range relPath {
					if c == '/' {
						depth++
					}
				}
				depth++ // Add 1 for the file/dir itself
			}

			// Apply max depth limit
			if s.options.MaxDepth > 0 && depth > s.options.MaxDepth {
				if d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}

			// Apply gitignore filtering
			if s.shouldIgnore(absPath, d.IsDir()) {
				if d.IsDir() {
					return fs.SkipDir
				}
				return nil
			}

			// Apply files-only filter
			if s.options.FilesOnly && d.IsDir() {
				return nil
			}

			// Add to results
			results = append(results, FileEntry{
				AbsPath: absPath,
				IsDir:   d.IsDir(),
			})
			seen[absPath] = true

			return nil
		})

		if err != nil && err != context.Canceled && err != context.DeadlineExceeded {
			// Log but don't fail on individual path errors
			continue
		}
	}

	// Force-include walk: scan directories listed in .claude/fuzzy-include
	// without gitignore filtering
	if s.options.RespectGitignore && len(s.options.Paths) > 0 {
		forceIncludes := loadForceIncludes(s.options.Paths[0])
		for _, entry := range forceIncludes {
			select {
			case <-ctx.Done():
				return results, ctx.Err()
			default:
			}

			// Skip hardcoded exclusions
			if filepath.Base(entry) == ".git" || filepath.Base(entry) == "node_modules" {
				continue
			}

			forceDir := filepath.Join(s.options.Paths[0], entry)

			// Resolve symlinks so WalkDir can enter symlinked directories.
			// Keep the original path for result reporting.
			resolvedDir, err := filepath.EvalSymlinks(forceDir)
			if err != nil {
				continue
			}
			info, err := os.Stat(resolvedDir)
			if err != nil || !info.IsDir() {
				continue
			}

			rootPath := s.options.Paths[0]

			err = filepath.WalkDir(resolvedDir, func(path string, d fs.DirEntry, err error) error {
				select {
				case <-ctx.Done():
					return ctx.Err()
				default:
				}
				if err != nil {
					return nil
				}

				// Remap the resolved path back to the original (symlinked) form.
				relToResolved, err := filepath.Rel(resolvedDir, path)
				if err != nil {
					return nil
				}
				var originalPath string
				if relToResolved == "." {
					originalPath = forceDir
				} else {
					originalPath = filepath.Join(forceDir, relToResolved)
				}
				absPath, err := filepath.Abs(originalPath)
				if err != nil {
					return nil
				}

				if seen[absPath] {
					return nil
				}

				// Hardcoded exclusions still apply
				base := filepath.Base(absPath)
				if base == ".git" || base == "node_modules" {
					if d.IsDir() {
						return fs.SkipDir
					}
					return nil
				}

				// Depth limit (relative to original root, not force-include dir)
				relPath, err := filepath.Rel(rootPath, absPath)
				if err != nil {
					return nil
				}
				depth := 1
				for _, c := range relPath {
					if c == '/' {
						depth++
					}
				}
				if s.options.MaxDepth > 0 && depth > s.options.MaxDepth {
					if d.IsDir() {
						return fs.SkipDir
					}
					return nil
				}

				if s.options.FilesOnly && d.IsDir() {
					return nil
				}

				results = append(results, FileEntry{
					AbsPath: absPath,
					IsDir:   d.IsDir(),
				})
				seen[absPath] = true
				return nil
			})

			if err != nil && err != context.Canceled && err != context.DeadlineExceeded {
				continue
			}
		}
	}

	return results, nil
}

// shouldIgnore checks if path matches gitignore patterns
func (s *Scanner) shouldIgnore(path string, isDir bool) bool {
	if s.gitignore == nil {
		return false
	}

	// Always ignore common directories even if not in .gitignore
	base := filepath.Base(path)
	if base == ".git" || base == "node_modules" {
		return true
	}

	// Get relative path from first root for gitignore matching
	relPath, err := filepath.Rel(s.options.Paths[0], path)
	if err != nil {
		return false
	}

	// For directories, append trailing slash for proper gitignore matching
	if isDir {
		relPath = relPath + "/"
	}

	return s.gitignore.MatchesPath(relPath)
}

// validatePaths ensures all paths are absolute directories
func validatePaths(paths []string) error {
	if len(paths) == 0 {
		return fmt.Errorf("at least one path required")
	}

	for _, p := range paths {
		if !filepath.IsAbs(p) {
			return fmt.Errorf("path must be absolute: %s", p)
		}

		info, err := os.Stat(p)
		if err != nil {
			return fmt.Errorf("cannot access path %s: %w", p, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("path is not a directory: %s", p)
		}
	}

	return nil
}

// loadGitignore parses .gitignore file
func loadGitignore(path string) (*ignore.GitIgnore, error) {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return nil, err
	}
	return ignore.CompileIgnoreFile(path)
}

// loadForceIncludes reads .claude/fuzzy-include from the given root path.
// Returns a list of relative directory paths that should be included
// in scan results even if gitignored. Returns nil if the file
// doesn't exist or can't be read.
func loadForceIncludes(rootPath string) []string {
	data, err := os.ReadFile(filepath.Join(rootPath, ".claude", "fuzzy-include"))
	if err != nil {
		return nil
	}
	var entries []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		// Normalize: strip trailing slash and leading ./
		line = strings.TrimSuffix(line, "/")
		line = strings.TrimPrefix(line, "./")
		if line == "" {
			continue
		}
		entries = append(entries, line)
	}
	return entries
}
