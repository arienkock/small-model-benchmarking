import json
import unittest
import threading
import time
import urllib.request
import urllib.error

# Helper to start server on a given port
def start_server(port):
    import os
    os.environ['PORT'] = str(port)
    # We need to run the server in a separate thread
    from app import run_server
    # Actually, let's just use subprocess or threading
    pass

class TestBookAPI(unittest.TestCase):
    """Test suite for the book API"""
    
    @classmethod
    def setUpClass(cls):
        # Start server on a free port
        import os
        cls.port = 8001
        os.environ['PORT'] = str(cls.port)
        # Run server in background thread
        from app import BookServer, HTTPServer
        cls.server = HTTPServer(('127.0.0.1', cls.port), BookServer)
        cls.server_thread = threading.Thread(target=cls.server.serve_forever)
        cls.server_thread.daemon = True
        cls.server_thread.start()
        # Give server time to start
        time.sleep(1)
    
    @classmethod
    def tearDownClass(cls):
        # Stop server
        if hasattr(cls, 'server') and cls.server:
            cls.server.shutdown()
        import os
        os.environ.pop('PORT', None)
    
    def make_request(self, method, path, body=None, query=None):
        url = f'http://127.0.0.1:{self.port}{path}'
        if query:
            url += '?' + query
        req = urllib.request.Request(url, data=body.encode('utf-8') if body else None, method=method)
        try:
            with urllib.request.urlopen(req) as resp:
                return resp.status, resp.read().decode('utf-8')
        except urllib.error.HTTPError as e:
            # HTTPError has a read() that returns the response body
            error_body = e.read().decode('utf-8') if e.read() else ''
            return e.code, error_body
    
    def test_create_book(self):
        """S1: Happy path - create a book"""
        status, body = self.make_request('POST', '/books', 
                                         json={'title': '1984', 'author': 'Orwell', 'isbn': '123456'})
        self.assertEqual(status, 201)
        data = json.loads(body)
        self.assertIn('id', data)
        self.assertEqual(data['title'], '1984')
        self.assertEqual(data['author'], 'Orwell')
        self.assertEqual(data['isbn'], '123456')
        self.assertEqual(data['synopsis'], '')
    
    def test_get_book(self):
        """S2: Happy path - get a book by id"""
        # First create a book to have an id
        status, body = self.make_request('POST', '/books', 
                                         json={'title': '1984', 'author': 'Orwell', 'isbn': '123456'})
        self.assertEqual(status, 201)
        data = json.loads(body)
        book_id = data['id']
        
        status, body = self.make_request('GET', f'/books/{book_id}')
        self.assertEqual(status, 200)
        response = json.loads(body)
        self.assertEqual(response['id'], book_id)
        self.assertEqual(response['title'], '1984')
    
    def test_update_book(self):
        """S3: Happy path - update a book"""
        # Create a book first
        status, body = self.make_request('POST', '/books', 
                                         json={'title': '1984', 'author': 'Orwell', 'isbn': '123456'})
        self.assertEqual(status, 201)
        data = json.loads(body)
        book_id = data['id']
        
        # Update the book
        new_data = {
            'title': 'Nineteen Eighty-Four',
            'author': 'George Orwell',
            'isbn': '123456',
            'synopsis': 'A dystopian novel'
        }
        status, body = self.make_request('PUT', f'/books/{book_id}', json=new_data)
        self.assertEqual(status, 200)
        response = json.loads(body)
        self.assertEqual(response['title'], 'Nineteen Eighty-Four')
        self.assertEqual(response['author'], 'George Orwell')
    
    def test_missing_required_field(self):
        """S4: Unhappy - missing required field (empty isbn)"""
        status, body = self.make_request('POST', '/books', 
                                         json={'title': 'Test', 'author': 'Author', 'isbn': ''})
        self.assertEqual(status, 400)
        error_msg = body.strip()
        # Check that the error mentions isbn
        self.assertIn('isbn', error_msg.lower())
    
    def test_invalid_json_body(self):
        """S5: Unhappy - invalid JSON body"""
        status, body = self.make_request('POST', '/books', 
                                         body='not json at all')
        self.assertEqual(status, 400)
        error_msg = body.strip()
        # Should be a generic error
        self.assertIn('error', error_msg.lower())
    
    def test_unknown_query_param(self):
        """S6: Unhappy - unknown query parameter in GET /books"""
        status, body = self.make_request('GET', '/books?id=1&unknown=foo')
        self.assertEqual(status, 400)
        error_msg = body.strip()
        # Should be a generic error
        self.assertIn('error', error_msg.lower())
    
    def test_id_not_integer(self):
        """S7: Unhappy - non-integer id in GET /books/{id}"""
        status, body = self.make_request('GET', '/books/abc')
        self.assertEqual(status, 404)

if __name__ == '__main__':
    unittest.main()
