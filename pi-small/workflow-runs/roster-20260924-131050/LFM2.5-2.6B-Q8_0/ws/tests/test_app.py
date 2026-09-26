import unittest
import json
import threading
import time
from http.client import HTTPConnection

import sys
sys.path.insert(0, '/workspace')

# Import the server handler and app logic
from app import BookHandler, HTTPServer


class TestBookAPI(unittest.TestCase):
    """
    Tests for the book API.
    """
    
    @classmethod
    def setUpClass(cls):
        # Start the server in a background thread before any tests run
        cls.server_thread = threading.Thread(target=run_server)
        # Ensure server is running
        run_server()
        cls.server_thread.daemon = True
        cls.server_thread.start()
        # Give server time to start
        time.sleep(1)
    
    @classmethod
    def tearDownClass(cls):
        # Stop the server
        cls.server_thread.join(timeout=5)
    
    def _start_server(self):
        """Start the HTTP server on port 8000 in a background thread."""
        import os
        os.environ["PORT"] = "8000"
        server = HTTPServer(("127.0.0.1", 8000), BookHandler)
        self.server = server
    
    def _stop_server(self):
        """Stop the HTTP server."""
        if hasattr(self, 'server'):
            self.server.shutdown()
            self.server.server_close()
    
    def _make_request(self, method, path, body=None, query_params=None):
        """Make an HTTP request and return (status, response_body)."""
        conn = HTTPConnection("127.0.0.1", 8000)
        try:
            if body and isinstance(body, str):
                conn.request(method, path, body=body.encode())
            elif body:
                conn.request(method, path, body=json.dumps(body).encode())
            else:
                conn.request(method, path)
            
            response = conn.getresponse()
            status = response.status
            body = response.read().decode("utf-8")
            return status, body
        finally:
            conn.close()
    
    def test_S1_create_book(self):
        """S1: Create book and get ID - happy path."""
        # POST /books with valid data
        response_status, response_body = self._make_request(
            "POST", "/books", {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}
        )
        self.assertEqual(response_status, 201)
        book = json.loads(response_body)
        self.assertIn("id", book)
        self.assertEqual(book["id"], 1)
        self.assertEqual(book["title"], "Dune")
        self.assertEqual(book["author"], "Frank Herbert")
        self.assertEqual(book["isbn"], "12345")
    
    def test_T1_S1_create_book(self):
        """T1.S1: Create book and get ID - happy path (duplicate of S1)."""
        response_status, _ = self._make_request(
            "POST", "/books", {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}
        )
        self.assertEqual(response_status, 201)
        book = json.loads(_)
        self.assertIn("id", book)
        self.assertEqual(book["id"], 1)
    
    def test_T1_S2_get_by_id(self):
        """T1.S2: Retrieve book by ID - happy path."""
        # First create a book to get an ID
        response_status, _ = self._make_request(
            "POST", "/books", {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}
        )
        self.assertEqual(response_status, 201)
        
        # Now get it by ID
        response_status, body = self._make_request(
            "GET", "/books/1"
        )
        self.assertEqual(response_status, 200)
        book = json.loads(body)
        self.assertIn("id", book)
        self.assertEqual(book["id"], 1)
    
    def test_T1_S3_get_existing_by_id(self):
        """T1.S3: Fetch existing book by ID - happy path."""
        # Create a book first
        response_status, _ = self._make_request(
            "POST", "/books", {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}
        )
        self.assertEqual(response_status, 201)
        
        # Get it by ID
        response_status, body = self._make_request(
            "GET", "/books/1"
        )
        self.assertEqual(response_status, 200)
        book = json.loads(body)
        self.assertIn("id", book)
    
    def test_T1_S4_create_missing_required_field(self):
        """T1.S4: Create book missing required field - unhappy (400)."""
        # Missing title
        response_status, body = self._make_request(
            "POST", "/books", {"author": "Frank Herbert", "isbn": "12345"}
        )
        self.assertEqual(response_status, 400)
        error_msg = json.loads(body).get("error", "")
        self.assertIn("title", error_msg.lower())
    
    def test_T1_S5_invalid_json_put(self):
        """T1.S5: Update with invalid JSON - unhappy (400)."""
        # First create a book
        response_status, _ = self._make_request(
            "POST", "/books", {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}
        )
        
        # Try to update with invalid JSON
        response_status, body = self._make_request(
            "PUT", "/books/1", "{invalid json}"
        )
        self.assertEqual(response_status, 400)
        error_msg = json.loads(body).get("error", "")
        self.assertIn("JSON", error_msg.lower())
    
    def test_T1_S6_query_unknown_param_on_list(self):
        """T1.S6: Query with unknown parameter on list - unhappy (400)."""
        # Create a book first
        response_status, _ = self._make_request(
            "POST", "/books", {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}
        )
        
        # Try to list with unknown parameter
        response_status, body = self._make_request(
            "GET", "/books?unknown_param=value"
        )
        self.assertEqual(response_status, 400)
        error_msg = json.loads(body).get("error", "")
        self.assertIn("unknown", error_msg.lower())
    
    def test_T1_S7_missing_title_in_create(self):
        """T1.S7: Missing required field in create - unhappy (400)."""
        # Missing title
        response_status, body = self._make_request(
            "POST", "/books", {"author": "Frank Herbert", "isbn": "12345"}
        )
        self.assertEqual(response_status, 400)
        error_msg = json.loads(body).get("error", "")
        self.assertIn("title", error_msg.lower())
    
    def test_T1_S8_invalid_json_put_duplicate(self):
        """T1.S8: Invalid JSON body in PUT (duplicate) - unhappy (400)."""
        # First create a book
        response_status, _ = self._make_request(
            "POST", "/books", {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}
        )
        
        # Try to update with invalid JSON
        response_status, body = self._make_request(
            "PUT", "/books/1", "{invalid json}"
        )
        self.assertEqual(response_status, 400)
        error_msg = json.loads(body).get("error", "")
        self.assertIn("JSON", error_msg.lower())
    
    def test_T1_S9_unknown_query_param_on_list(self):
        """T1.S9: Unknown query parameter on list - unhappy (400)."""
        # Create a book first
        response_status, _ = self._make_request(
            "POST", "/books", {"title": "Dune", "author": "Frank Herbert", "isbn": "12345"}
        )
        
        # Try to list with unknown parameter
        response_status, body = self._make_request(
            "GET", "/books?unknown_param=value"
        )
        self.assertEqual(response_status, 400)
        error_msg = json.loads(body).get("error", "")
        self.assertIn("unknown", error_msg.lower())
